<?php

declare(strict_types=1);

namespace Tests\Feature\Actions;

use App\Models\User;
use App\Modules\Integrations\Actions\ConnectYandexDiskAction;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Services\CloudFailure;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class ConnectYandexDiskActionTest extends TestCase
{
    use RefreshDatabase;

    public function test_reconnecting_with_another_yandex_account_preserves_the_original_connection(): void
    {
        config([
            'services.yandex.client_id' => 'client',
            'services.yandex.client_secret' => 'secret',
            'services.yandex.redirect_uri' => 'https://example.test/callback',
        ]);
        Http::preventStrayRequests();
        Http::fake([
            'oauth.yandex.ru/token' => Http::response(['access_token' => 'new', 'refresh_token' => 'refresh', 'expires_in' => 3600]),
            'cloud-api.yandex.net/v1/disk' => Http::response(['user' => ['uid' => 'another-account']]),
        ]);
        $user = User::factory()->create(['role' => 'employee']);
        $credentials = ['token' => 'original', 'account_id' => 'original-account'];
        $connection = CloudConnection::query()->create([
            'owner_id' => $user->id,
            'provider' => CloudProviderId::YANDEX->value,
            'name' => 'Рабочий диск',
            'credentials' => $credentials,
        ])->refresh();

        try {
            app(ConnectYandexDiskAction::class)->handle($user, 'code', [
                'verifier' => str_repeat('a', 64),
                'password' => hash('sha256', $user->getAuthPassword()),
                'connection_id' => $connection->id,
                'connection_fingerprint' => $connection->getCredentialsFingerprint(),
            ]);
            self::fail('Подключение другого диска должно быть отклонено.');
        } catch (CloudFailure $error) {
            self::assertSame('ACCESS_REVOKED', $error->getMessage());
        }

        self::assertSame($credentials, CloudConnection::query()->sole()->credentials);
    }
}
