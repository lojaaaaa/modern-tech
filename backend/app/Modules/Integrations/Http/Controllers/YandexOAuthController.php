<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Controllers;

use App\Models\User;
use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Actions\ConnectYandexDiskAction;
use App\Modules\Integrations\Cache\YandexOAuthCache;
use App\Modules\Integrations\Enums\YandexAuthorizationResult;
use App\Modules\Integrations\Exceptions\CloudOAuthNotConfigured;
use App\Modules\Integrations\Http\Requests\StartYandexOAuthRequest;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\YandexOAuth;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

final class YandexOAuthController
{
    public const START_THROTTLE_PREFIX = 'yandex-oauth-start:';

    public const CALLBACK_THROTTLE_PREFIX = 'yandex-oauth-callback:';

    public function availability(YandexOAuth $oauth): JsonResponse
    {
        return response()->json(['data' => ['available' => $oauth->isConfigured()]]);
    }

    public function start(StartYandexOAuthRequest $request, YandexOAuth $oauth): JsonResponse
    {
        $connection = $request->getConnection();

        try {
            $url = $oauth->getAuthorizationUrl($request->user(), $request->session()->getId(), $connection);
        } catch (CloudOAuthNotConfigured) {
            abort(503, 'Подключение Яндекс Диска пока недоступно. Обратитесь к администратору.');
        }

        return response()->json(['data' => ['url' => $url]]);
    }

    public function callback(Request $request, YandexOAuthCache $cache, ConnectYandexDiskAction $connect): RedirectResponse
    {
        $user = $request->user();
        $user = $user instanceof User ? $user->fresh() : null;
        $state = $request->query('state');
        if (! $user || ! $user->isActive() || $user->role === UserRole::OBSERVER || ! is_string($state)) {
            return $this->back(YandexAuthorizationResult::EXPIRED);
        }
        try {
            $pending = $cache->getAndConsumeState($user, $request->session()->getId(), $state);
            if ($request->query('error') === 'access_denied') {
                return $this->back(YandexAuthorizationResult::CANCELLED);
            }
            $code = $request->query('code');
            if ($request->has('error') || ! is_string($code) || $code === '' || strlen($code) > 4096) {
                return $this->back(YandexAuthorizationResult::FAILED);
            }
            $connection = $connect->handle($user, $code, $pending);

            return $this->back(YandexAuthorizationResult::CONNECTED, $connection->id);
        } catch (CloudFailure $error) {
            return $this->back($error->getMessage() === 'OAUTH_STATE_INVALID'
                ? YandexAuthorizationResult::EXPIRED
                : YandexAuthorizationResult::FAILED);
        } catch (LockTimeoutException) {
            return $this->back(YandexAuthorizationResult::FAILED);
        }
    }

    private function back(YandexAuthorizationResult $result, ?string $connectionId = null): RedirectResponse
    {
        return redirect('/integrations?'.http_build_query(array_filter(['yandex' => $result->value, 'connection' => $connectionId])))
            ->withHeaders(['Referrer-Policy' => 'no-referrer']);
    }
}
