<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class YandexOAuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.yandex.client_id' => 'test-client', 'services.yandex.client_secret' => 'test-secret', 'services.yandex.redirect_uri' => 'http://localhost:8088/api/v1/connections/yandex/callback']);
        Http::preventStrayRequests();
    }

    private function start(?CloudConnection $connection = null): array
    {
        $url = $this->postJson('/api/v1/connections/yandex/authorization', $connection ? ['connection_id' => $connection->id] : [])
            ->assertOk()->json('data.url');
        $this->withCookie(config('session.cookie'), session()->getId());
        parse_str(parse_url($url, PHP_URL_QUERY), $params);

        return $params;
    }

    private function fakeGrant(): void
    {
        Http::fake([
            'oauth.yandex.ru/token' => Http::response(['access_token' => 'access-test', 'refresh_token' => 'refresh-test', 'expires_in' => 3600]),
            'cloud-api.yandex.net/v1/disk' => Http::response(['user' => ['uid' => '123', 'display_name' => 'Тестовый диск']]),
        ]);
    }

    public function test_authorization_uses_pkce_and_callback_stores_encrypted_tokens_only_after_checking_disk(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'employee']));
        $start = $this->start();
        $this->assertSame('code', $start['response_type']);
        $this->assertSame('S256', $start['code_challenge_method']);
        $this->assertSame(config('services.yandex.redirect_uri'), $start['redirect_uri']);
        $this->assertStringNotContainsString('test-secret', http_build_query($start));
        $this->fakeGrant();
        $response = $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'test-code']))->assertRedirect();
        $this->assertStringContainsString('/integrations?yandex=connected', $response->headers->get('Location'));
        $connection = CloudConnection::sole();
        $this->assertSame('connected', $connection->status);
        $this->assertStringContainsString('Тестовый диск', $connection->name);
        $this->assertSame('access-test', $connection->credentials['token']);
        $this->assertSame('refresh-test', $connection->credentials['refresh_token']);
        $this->assertArrayHasKey('expires_at', $connection->credentials);
        $this->assertStringNotContainsString('access-test', $connection->getRawOriginal('credentials'));
        $this->getJson('/api/v1/connections')->assertJsonMissingPath('data.0.credentials');
        Http::assertSent(function ($request) use ($start) {
            if ($request->url() !== 'https://oauth.yandex.ru/token') {
                return false;
            }
            $challenge = rtrim(strtr(base64_encode(hash('sha256', $request['code_verifier'], true)), '+/', '-_'), '=');

            return $request['code'] === 'test-code' && $challenge === $start['code_challenge'] && $request->hasHeader('Authorization', 'Basic '.base64_encode('test-client:test-secret'));
        });
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'test-code']))->assertRedirect('/integrations?yandex=expired');
        Http::assertSentCount(2);
    }

    public function test_callback_rejects_invalid_state_and_a_different_user_without_consuming_the_rightful_flow(): void
    {
        $owner = User::factory()->create(['role' => 'employee']);
        $other = User::factory()->create(['role' => 'employee']);
        $this->actingAs($owner);
        $start = $this->start();
        $this->actingAs($other)->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect('/integrations?yandex=expired');
        Http::assertNothingSent();
        $this->fakeGrant();
        $this->actingAs($owner)->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect();
        $this->assertSame($owner->id, CloudConnection::sole()->owner_id);
    }

    public function test_denied_consent_and_expired_state_do_not_create_connections(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'employee']));
        $start = $this->start();
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'error' => 'access_denied']))->assertRedirect('/integrations?yandex=cancelled');
        $start = $this->start();
        $this->travel(11)->minutes();
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect('/integrations?yandex=expired');
        $this->assertDatabaseCount('cloud_connections', 0);
        Http::assertNothingSent();
    }

    public function test_missing_configuration_observer_and_foreign_connection_cannot_start_authorization(): void
    {
        $owner = User::factory()->create(['role' => 'employee']);
        $foreign = CloudConnection::create(['owner_id' => $owner->id, 'provider' => 'yandex', 'name' => 'Private', 'credentials' => ['token' => 'private']]);
        $this->actingAs(User::factory()->create(['role' => 'employee']))->postJson('/api/v1/connections/yandex/authorization', ['connection_id' => $foreign->id])->assertNotFound();
        $this->actingAs(User::factory()->create(['role' => 'observer']))->postJson('/api/v1/connections/yandex/authorization')->assertForbidden();
        $this->actingAs($owner);
        config(['services.yandex.client_secret' => null]);
        $this->getJson('/api/v1/connections/yandex/authorization')->assertOk()->assertJsonPath('data.available', false);
        $this->postJson('/api/v1/connections/yandex/authorization')->assertStatus(503);
        Http::assertNothingSent();
    }

    public function test_disk_refusal_does_not_create_a_falsely_connected_account(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'employee']));
        $start = $this->start();
        Http::fake([
            'oauth.yandex.ru/token' => Http::response(['access_token' => 'access-test', 'refresh_token' => 'refresh-test', 'expires_in' => 3600]),
            'cloud-api.yandex.net/v1/disk' => Http::response([], 403),
        ]);
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect('/integrations?yandex=failed');
        $this->assertDatabaseCount('cloud_connections', 0);
    }

    private function expiredConnection(): CloudConnection
    {
        $owner = User::factory()->create(['role' => 'employee']);
        $this->actingAs($owner);

        return CloudConnection::create(['owner_id' => $owner->id, 'provider' => 'yandex', 'name' => 'Disk', 'credentials' => ['token' => 'old-access', 'refresh_token' => 'old-refresh', 'expires_at' => now()->subMinute()->toIso8601String(), 'account_id' => '123']]);
    }

    public function test_expired_token_is_refreshed_before_listing_files(): void
    {
        $connection = $this->expiredConnection();
        Http::fake([
            'oauth.yandex.ru/token' => Http::response(['access_token' => 'new-access', 'refresh_token' => 'new-refresh', 'expires_in' => 3600]),
            'cloud-api.yandex.net/*' => Http::response(['_embedded' => ['items' => []]]),
        ]);
        $this->getJson('/api/v1/connections/'.$connection->id.'/files')->assertOk()->assertJsonPath('data', []);
        $this->assertSame('new-access', $connection->fresh()->credentials['token']);
        $this->assertSame('new-refresh', $connection->fresh()->credentials['refresh_token']);
        $this->assertSame('123', $connection->fresh()->credentials['account_id']);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/resources') && $request->hasHeader('Authorization', 'OAuth new-access'));
        Http::assertSentCount(2);
    }

    public function test_unauthorized_request_refreshes_once_and_retries_only_the_metadata_request(): void
    {
        $connection = $this->expiredConnection();
        $connection->credentials = array_merge($connection->credentials, ['expires_at' => now()->addHour()->toIso8601String()]);
        $connection->save();
        Http::fake([
            'oauth.yandex.ru/token' => Http::response(['access_token' => 'new-access', 'refresh_token' => 'new-refresh', 'expires_in' => 3600]),
            'cloud-api.yandex.net/*' => Http::sequence()->push([], 401)->push(['_embedded' => ['items' => []]]),
        ]);
        $this->getJson('/api/v1/connections/'.$connection->id.'/files')->assertOk();
        Http::assertSentCount(3);
        $this->assertSame('new-access', $connection->fresh()->credentials['token']);
    }

    public function test_revoked_refresh_token_requires_reauthorization_and_does_not_look_connected(): void
    {
        $connection = $this->expiredConnection();
        Http::fake(['oauth.yandex.ru/token' => Http::response(['error' => 'invalid_grant'], 400)]);
        $this->getJson('/api/v1/connections/'.$connection->id.'/files')->assertUnprocessable()->assertJsonPath('error.message', 'Доступ к Яндекс Диску истёк или отозван. Подключите диск заново через Яндекс.');
        $this->assertSame('authorization_required', $connection->fresh()->status);
        Http::assertSentCount(1);
    }

    public function test_disconnect_during_refresh_cannot_restore_credentials(): void
    {
        $connection = $this->expiredConnection();
        Http::fake(function () use ($connection) {
            $connection->update(['status' => 'disconnected', 'credentials' => []]);

            return Http::response(['access_token' => 'new-access', 'refresh_token' => 'new-refresh', 'expires_in' => 3600]);
        });
        $this->getJson('/api/v1/connections/'.$connection->id.'/files')->assertStatus(502);
        $this->assertSame('disconnected', $connection->fresh()->status);
        $this->assertSame([], $connection->fresh()->credentials);
    }

    public function test_reconnecting_an_account_keeps_its_connection_id_and_prevents_duplicates(): void
    {
        $connection = $this->expiredConnection();
        $start = $this->start($connection);
        $this->fakeGrant();
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect();
        $this->assertDatabaseCount('cloud_connections', 1);
        $this->assertSame($connection->id, CloudConnection::sole()->id);
        $this->assertSame('access-test', $connection->fresh()->credentials['token']);
        $start = $this->start();
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect();
        $this->assertDatabaseCount('cloud_connections', 1);
    }

    public function test_a_different_session_cannot_use_the_pending_state(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'employee']));
        $start = $this->start();
        $this->withCookie(config('session.cookie'), str_repeat('x', 40));
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect('/integrations?yandex=expired');
        Http::assertNothingSent();
    }

    public function test_a_transient_refresh_failure_keeps_the_connection_and_its_credentials(): void
    {
        $connection = $this->expiredConnection();
        Http::fake(['oauth.yandex.ru/token' => Http::response([], 503)]);
        $this->getJson('/api/v1/connections/'.$connection->id.'/files')->assertStatus(502);
        $this->assertSame('connected', $connection->fresh()->status);
        $this->assertSame('old-refresh', $connection->fresh()->credentials['refresh_token']);
    }

    public function test_disconnect_while_consent_is_open_is_not_undone_by_the_callback(): void
    {
        $connection = $this->expiredConnection();
        $start = $this->start($connection);
        $this->deleteJson('/api/v1/connections/'.$connection->id)->assertOk();
        $this->fakeGrant();
        $this->get('/api/v1/connections/yandex/callback?'.http_build_query(['state' => $start['state'], 'code' => 'code']))->assertRedirect('/integrations?yandex=failed');
        $this->assertSame('disconnected', $connection->fresh()->status);
        $this->assertSame([], $connection->fresh()->credentials);
    }
}
