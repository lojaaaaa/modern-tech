<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Models\User;
use App\Modules\Integrations\Cache\YandexOAuthCache;
use App\Modules\Integrations\Enums\CloudConnectionStatus;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Exceptions\CloudAuthorizationRequired;
use App\Modules\Integrations\Exceptions\CloudOAuthNotConfigured;
use App\Modules\Integrations\Models\CloudConnection;
use GuzzleHttp\Exception\GuzzleException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

final class YandexOAuth
{
    public function __construct(private readonly YandexOAuthCache $cache)
    {
    }

    public function isConfigured(): bool
    {
        return filled(config('services.yandex.client_id')) && filled(config('services.yandex.client_secret'))
            && filled(config('services.yandex.redirect_uri'));
    }

    public function getAuthorizationUrl(User $user, string $sessionId, ?CloudConnection $connection): string
    {
        $provider = $this->getProvider();
        $state = Str::random(64);
        $url = $provider->getAuthorizationUrl(['state' => $state, 'force_confirm' => 'yes', 'approval_prompt' => null]);
        $this->cache->store($user, $sessionId, $state, [
            'verifier' => $provider->getPkceCode(),
            'connection_id' => $connection?->id,
            'connection_fingerprint' => $connection?->getCredentialsFingerprint(),
        ]);

        return $url;
    }

    public function getAccessToken(CloudConnection $connection, ?string $rejectedToken = null): string
    {
        return $this->cache->withRefreshLock($connection->id, function () use ($connection, $rejectedToken): string {
            $fresh = CloudConnection::query()
                ->whereKey($connection->id)
                ->where('owner_id', $connection->owner_id)
                ->firstOrFail();
            if ($fresh->status !== CloudConnectionStatus::CONNECTED) {
                throw new CloudAuthorizationRequired(CloudProviderId::YANDEX);
            }
            $credentials = $fresh->credentials;
            $token = $credentials['token'] ?? '';
            if ($token !== '' && (($rejectedToken !== null && $token !== $rejectedToken)
                || ($rejectedToken === null && (! isset($credentials['expires_at']) || Carbon::parse($credentials['expires_at'])->isAfter(now()->addMinute()))))) {
                return $token;
            }
            $original = $fresh->getRawOriginal('credentials');
            if (empty($credentials['refresh_token'])) {
                $this->requireAuthorization($fresh, $original);
                throw new CloudAuthorizationRequired(CloudProviderId::YANDEX);
            }
            try {
                $tokens = $this->requestTokens($this->getProvider(), 'refresh_token', ['refresh_token' => $credentials['refresh_token']]);
            } catch (CloudAuthorizationRequired $error) {
                $this->requireAuthorization($fresh, $original);
                throw $error;
            }
            $fresh->credentials = array_merge($credentials, $tokens);
            // Disconnect or a new OAuth callback may win while the provider responds.
            $updated = CloudConnection::query()
                ->whereKey($fresh->id)
                ->where('status', CloudConnectionStatus::CONNECTED)
                ->where('credentials', $original)
                ->update(['credentials' => $fresh->getAttributes()['credentials']]);
            if ($updated !== 1) {
                throw new CloudFailure('ACCESS_REVOKED');
            }

            return $tokens['token'];
        });
    }

    /** @return array{token: string, refresh_token: string, expires_at: string} */
    public function exchangeCode(string $code, string $verifier): array
    {
        $provider = $this->getProvider();
        $provider->setPkceCode($verifier);

        return $this->requestTokens($provider, 'authorization_code', ['code' => $code]);
    }

    private function getProvider(): YandexOAuthProvider
    {
        if (! $this->isConfigured()) {
            throw new CloudOAuthNotConfigured();
        }

        return new YandexOAuthProvider();
    }

    /** @param array<string, string> $fields
     * @return array{token: string, refresh_token: string, expires_at: string}
     */
    private function requestTokens(YandexOAuthProvider $provider, string $grant, array $fields): array
    {
        try {
            $token = $provider->getAccessToken($grant, $fields);
        } catch (GuzzleException) {
            throw new CloudFailure('PROVIDER_UNAVAILABLE');
        } catch (\UnexpectedValueException) {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }

        return [
            'token' => $token->getToken(),
            'refresh_token' => $token->getRefreshToken(),
            'expires_at' => Carbon::createFromTimestampUTC($token->getExpires())->toIso8601String(),
        ];
    }

    private function requireAuthorization(CloudConnection $connection, string $original): void
    {
        CloudConnection::query()
            ->whereKey($connection->id)
            ->where('status', CloudConnectionStatus::CONNECTED)
            ->where('credentials', $original)
            ->update(['status' => CloudConnectionStatus::AUTHORIZATION_REQUIRED]);
    }
}
