<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Models\User;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

final class YandexOAuth
{
    public function configured(): bool
    {
        foreach (['client_id', 'client_secret', 'redirect_uri'] as $key) {
            if (! is_string(config('services.yandex.'.$key)) || trim(config('services.yandex.'.$key)) === '') {
                return false;
            }
        }
        $url = parse_url(config('services.yandex.redirect_uri'));

        return is_array($url) && in_array($url['scheme'] ?? '', ['http', 'https'], true) && isset($url['host']) && ! isset($url['user']) && ! isset($url['pass']) && ! isset($url['fragment']);
    }

    public function authorizationUrl(User $user, string $sessionId, ?CloudConnection $connection): string
    {
        if (! $this->configured()) {
            throw new CloudFailure('OAUTH_NOT_CONFIGURED');
        }
        $state = Str::random(64);
        $verifier = $this->encode(random_bytes(64));
        Cache::put('yandex-oauth:'.hash('sha256', $state), [
            'user_id' => $user->id,
            'session' => hash('sha256', $sessionId),
            'password' => hash('sha256', $user->getAuthPassword()),
            'verifier' => $verifier,
            'connection_id' => $connection?->id,
            'connection_fingerprint' => $connection ? $this->fingerprint($connection) : null,
        ], 600);

        return 'https://oauth.yandex.ru/authorize?'.http_build_query([
            'response_type' => 'code',
            'client_id' => config('services.yandex.client_id'),
            'redirect_uri' => config('services.yandex.redirect_uri'),
            'scope' => 'cloud_api:disk.read cloud_api:disk.write cloud_api:disk.info',
            'state' => $state,
            'code_challenge' => $this->encode(hash('sha256', $verifier, true)),
            'code_challenge_method' => 'S256',
            'force_confirm' => 'yes',
        ], '', '&', PHP_QUERY_RFC3986);
    }

    /** @return array<string, mixed> */
    public function consumeState(User $user, string $sessionId, string $state): array
    {
        if (! preg_match('/^[a-zA-Z0-9]{64}$/D', $state)) {
            throw new CloudFailure('OAUTH_STATE_INVALID');
        }
        $key = 'yandex-oauth:'.hash('sha256', $state);

        return Cache::lock($key.':consume', 10)->block(3, function () use ($key, $user, $sessionId): array {
            $pending = Cache::get($key);
            if (! is_array($pending) || $pending['user_id'] !== $user->id
                || ! hash_equals($pending['session'], hash('sha256', $sessionId))
                || ! hash_equals($pending['password'], hash('sha256', $user->getAuthPassword()))) {
                throw new CloudFailure('OAUTH_STATE_INVALID');
            }
            Cache::forget($key);

            return $pending;
        });
    }

    /** @param array<string, mixed> $pending */
    public function connect(User $user, string $code, array $pending): CloudConnection
    {
        $credentials = $this->requestTokens(['grant_type' => 'authorization_code', 'code' => $code, 'code_verifier' => $pending['verifier']]);
        try {
            $response = Http::connectTimeout(5)->timeout(15)->withoutRedirecting()->withToken($credentials['token'], 'OAuth')->get('https://cloud-api.yandex.net/v1/disk');
        } catch (ConnectionException) {
            throw new CloudFailure('PROVIDER_UNAVAILABLE');
        }
        CloudHttp::check($response);
        $account = $response->json('user.uid');
        if ((! is_string($account) && ! is_int($account)) || (string) $account === '') {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }
        $credentials['account_id'] = (string) $account;
        $label = $response->json('user.display_name') ?: $response->json('user.login');
        $name = is_string($label) ? 'Яндекс Диск · '.Str::limit($label, 75, '') : 'Яндекс Диск';

        return DB::transaction(function () use ($user, $pending, $credentials, $name): CloudConnection {
            $actor = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
            if (! $actor->active || $actor->role === 'observer' || ! hash_equals($pending['password'], hash('sha256', $actor->getAuthPassword()))) {
                throw new CloudFailure('ACCESS_REVOKED');
            }
            $connections = CloudConnection::where('owner_id', $actor->id)->where('provider', 'yandex')->get();
            if ($pending['connection_id']) {
                $connection = $connections->firstWhere('id', $pending['connection_id']);
                if (! $connection || ! hash_equals($pending['connection_fingerprint'], $this->fingerprint($connection))
                    || (isset($connection->credentials['account_id']) && $connection->credentials['account_id'] !== $credentials['account_id'])) {
                    throw new CloudFailure('ACCESS_REVOKED');
                }
            } else {
                $connection = $connections->first(fn (CloudConnection $item) => ($item->credentials['account_id'] ?? null) === $credentials['account_id']);
            }
            $connection ??= new CloudConnection(['owner_id' => $actor->id, 'provider' => 'yandex', 'name' => $name]);
            $connection->fill(['credentials' => $credentials, 'status' => 'connected'])->save();

            return $connection;
        });
    }

    public function accessToken(CloudConnection $connection, ?string $rejectedToken = null): string
    {
        return Cache::lock('yandex-refresh:'.$connection->id, 30)->block(5, function () use ($connection, $rejectedToken): string {
            $fresh = CloudConnection::whereKey($connection->id)->where('owner_id', $connection->owner_id)->firstOrFail();
            if ($fresh->status !== 'connected') {
                throw new CloudFailure('AUTHORIZATION_REQUIRED');
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
                throw new CloudFailure('AUTHORIZATION_REQUIRED');
            }
            try {
                $tokens = $this->requestTokens(['grant_type' => 'refresh_token', 'refresh_token' => $credentials['refresh_token']]);
            } catch (CloudFailure $error) {
                if ($error->getMessage() === 'AUTHORIZATION_REQUIRED') {
                    $this->requireAuthorization($fresh, $original);
                }
                throw $error;
            }
            $fresh->credentials = array_merge($credentials, $tokens);
            // Disconnect or a new OAuth callback may win while the provider responds.
            $updated = CloudConnection::whereKey($fresh->id)->where('status', 'connected')->where('credentials', $original)
                ->update(['credentials' => $fresh->getAttributes()['credentials']]);
            if ($updated !== 1) {
                throw new CloudFailure('ACCESS_REVOKED');
            }

            return $tokens['token'];
        });
    }

    /** @param array<string, string> $fields
     * @return array<string, string>
     */
    private function requestTokens(array $fields): array
    {
        if (! $this->configured()) {
            throw new CloudFailure('OAUTH_NOT_CONFIGURED');
        }
        try {
            $response = Http::connectTimeout(5)->timeout(15)->withoutRedirecting()->asForm()
                ->withBasicAuth(config('services.yandex.client_id'), config('services.yandex.client_secret'))
                ->post('https://oauth.yandex.ru/token', $fields);
        } catch (ConnectionException) {
            throw new CloudFailure('PROVIDER_UNAVAILABLE');
        }
        if (! $response->successful()) {
            throw new CloudFailure($response->json('error') === 'invalid_grant' ? 'AUTHORIZATION_REQUIRED' : 'PROVIDER_UNAVAILABLE');
        }
        $token = $response->json('access_token');
        $refresh = $response->json('refresh_token');
        $lifetime = $response->json('expires_in');
        if (! is_string($token) || $token === '' || ! is_string($refresh) || $refresh === '' || ! is_numeric($lifetime) || $lifetime <= 0) {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }

        return ['token' => $token, 'refresh_token' => $refresh, 'expires_at' => now()->addSeconds((int) $lifetime)->toIso8601String()];
    }

    private function requireAuthorization(CloudConnection $connection, string $original): void
    {
        CloudConnection::whereKey($connection->id)->where('status', 'connected')->where('credentials', $original)->update(['status' => 'authorization_required']);
    }

    private function fingerprint(CloudConnection $connection): string
    {
        return hash('sha256', $connection->getRawOriginal('credentials').'|'.$connection->status);
    }

    private function encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
