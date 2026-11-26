<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Cache;

use App\Models\User;
use App\Modules\Integrations\Services\CloudFailure;
use Closure;
use Illuminate\Support\Facades\Cache;

final class GoogleOAuthCache
{
    private const STATE_KEY_PREFIX = 'google-oauth:';

    private const STATE_LOCK_SUFFIX = ':consume';

    private const REFRESH_LOCK_PREFIX = 'google-refresh:';

    private const STATE_TTL_SECONDS = 600;

    private const STATE_LOCK_SECONDS = 10;

    private const STATE_WAIT_SECONDS = 3;

    private const REFRESH_LOCK_SECONDS = 30;

    private const REFRESH_WAIT_SECONDS = 5;

    /** @param array{verifier: ?string, connection_id: ?string, connection_fingerprint: ?string} $pending */
    public function store(User $user, string $sessionId, string $state, array $pending): void
    {
        Cache::put($this->getStateKey($state), [
            'user_id' => $user->id,
            'session' => hash('sha256', $sessionId),
            'password' => hash('sha256', $user->getAuthPassword()),
            ...$pending,
        ], self::STATE_TTL_SECONDS);
    }

    /** @return array<string, mixed> */
    public function getAndConsumeState(User $user, string $sessionId, string $state): array
    {
        if (! preg_match('/^[a-zA-Z0-9]{64}$/D', $state)) {
            throw new CloudFailure('OAUTH_STATE_INVALID');
        }

        $key = $this->getStateKey($state);

        return Cache::lock($key . self::STATE_LOCK_SUFFIX, self::STATE_LOCK_SECONDS)
            ->block(self::STATE_WAIT_SECONDS, function () use ($key, $user, $sessionId): array {
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

    /** @param Closure(): string $refresh */
    public function withRefreshLock(string $connectionId, Closure $refresh): string
    {
        return Cache::lock(self::REFRESH_LOCK_PREFIX . $connectionId, self::REFRESH_LOCK_SECONDS)
            ->block(self::REFRESH_WAIT_SECONDS, $refresh);
    }

    private function getStateKey(string $state): string
    {
        return self::STATE_KEY_PREFIX . hash('sha256', $state);
    }
}
