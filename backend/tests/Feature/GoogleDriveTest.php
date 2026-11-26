<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Integrations\Cache\GoogleOAuthCache;
use App\Modules\Integrations\Services\GoogleDisk;
use App\Modules\Integrations\Services\GoogleOAuth;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class GoogleDriveTest extends TestCase
{
    use RefreshDatabase;

    public function test_authorization_is_bound_to_user_session_and_pkce(): void
    {
        config(['services.google.client_id' => 'test-client', 'services.google.client_secret' => 'test-secret', 'services.google.redirect_uri' => 'http://localhost/api/v1/connections/google/callback']);
        $user = User::factory()->create();
        $url = app(GoogleOAuth::class)->getAuthorizationUrl($user, 'session-1', null);
        parse_str(parse_url($url, PHP_URL_QUERY), $query);
        $this->assertSame('accounts.google.com', parse_url($url, PHP_URL_HOST));
        $this->assertSame('offline', $query['access_type']);
        $this->assertSame('S256', $query['code_challenge_method']);
        $pending = app(GoogleOAuthCache::class)->getAndConsumeState($user, 'session-1', $query['state']);
        $this->assertNotEmpty($pending['verifier']);
        $this->expectException(\App\Modules\Integrations\Services\CloudFailure::class);
        app(GoogleOAuthCache::class)->getAndConsumeState($user, 'session-1', $query['state']);
    }

    public function test_listing_follows_pages_and_download_uses_only_google_origin(): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'https://www.googleapis.com/drive/v3/files?*' => Http::sequence()
                ->push(['files' => [['id' => 'file_1', 'name' => 'Report.pdf', 'mimeType' => 'application/pdf', 'size' => 10]], 'nextPageToken' => 'next'])
                ->push(['files' => [['id' => 'dir_1', 'name' => 'Reports', 'mimeType' => 'application/vnd.google-apps.folder']]]),
        ]);
        $files = (new GoogleDisk('token'))->files('/');
        $this->assertCount(2, $files);
        $this->assertSame('/@file_1', $files[0]['path']);
        $this->assertSame('/Reports', $files[1]['path']);
        $this->expectException(\App\Modules\Integrations\Services\CloudFailure::class);
        (new GoogleDisk('token'))->download('https://attacker.test/file', '/tmp/never-downloaded');
    }

    public function test_refresh_preserves_existing_refresh_token_when_google_omits_it(): void
    {
        config(['services.google.client_id' => 'test-client', 'services.google.client_secret' => 'test-secret', 'services.google.redirect_uri' => 'http://localhost/callback']);
        $owner = User::factory()->create();
        $connection = \App\Modules\Integrations\Models\CloudConnection::query()->create([
            'owner_id' => $owner->id, 'provider' => 'google', 'name' => 'Google Drive', 'status' => 'connected',
            'credentials' => ['token' => 'expired', 'refresh_token' => 'keep-me', 'expires_at' => now()->subMinute()->toIso8601String()],
        ]);
        Http::preventStrayRequests();
        Http::fake(['https://oauth2.googleapis.com/token' => Http::response(['access_token' => 'fresh', 'expires_in' => 3600, 'token_type' => 'Bearer'])]);
        $this->assertSame('fresh', app(GoogleOAuth::class)->getAccessToken($connection));
        $this->assertSame('keep-me', $connection->fresh()->credentials['refresh_token']);
    }

    public function test_observer_cannot_start_google_authorization(): void
    {
        $user = User::factory()->create(['role' => 'observer']);
        $this->actingAs($user)->postJson('/api/v1/connections/google/authorization')->assertForbidden();
    }
}
