<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Controllers;

use App\Models\User;
use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Actions\ConnectGoogleDiskAction;
use App\Modules\Integrations\Cache\GoogleOAuthCache;
use App\Modules\Integrations\Enums\OAuthAuthorizationResult;
use App\Modules\Integrations\Exceptions\CloudOAuthNotConfigured;
use App\Modules\Integrations\Http\Requests\StartGoogleOAuthRequest;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\GoogleOAuth;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

final class GoogleOAuthController
{
    public const START_THROTTLE_PREFIX = 'google-oauth-start:';

    public const CALLBACK_THROTTLE_PREFIX = 'google-oauth-callback:';

    public function availability(GoogleOAuth $oauth): JsonResponse
    {
        return response()->json(['data' => ['available' => $oauth->isConfigured()]]);
    }

    public function start(StartGoogleOAuthRequest $request, GoogleOAuth $oauth): JsonResponse
    {
        $connection = $request->getConnection();

        try {
            $url = $oauth->getAuthorizationUrl($request->user(), $request->session()->getId(), $connection);
        } catch (CloudOAuthNotConfigured) {
            abort(503, 'Подключение Google Drive пока недоступно. Обратитесь к администратору.');
        }

        return response()->json(['data' => ['url' => $url]]);
    }

    public function callback(Request $request, GoogleOAuthCache $cache, ConnectGoogleDiskAction $connect): RedirectResponse
    {
        $user = $request->user();
        $user = $user instanceof User ? $user->fresh() : null;
        $state = $request->query('state');
        if (! $user || ! $user->isActive() || $user->role === UserRole::OBSERVER || ! is_string($state)) {
            return $this->back(OAuthAuthorizationResult::EXPIRED);
        }
        try {
            $pending = $cache->getAndConsumeState($user, $request->session()->getId(), $state);
            if ($request->query('error') === 'access_denied') {
                return $this->back(OAuthAuthorizationResult::CANCELLED);
            }
            $code = $request->query('code');
            if ($request->has('error') || ! is_string($code) || $code === '' || strlen($code) > 4096) {
                return $this->back(OAuthAuthorizationResult::FAILED);
            }
            $connection = $connect->handle($user, $code, $pending);

            return $this->back(OAuthAuthorizationResult::CONNECTED, $connection->id);
        } catch (CloudFailure $error) {
            return $this->back($error->getMessage() === 'OAUTH_STATE_INVALID'
                ? OAuthAuthorizationResult::EXPIRED
                : OAuthAuthorizationResult::FAILED);
        } catch (LockTimeoutException) {
            return $this->back(OAuthAuthorizationResult::FAILED);
        }
    }

    private function back(OAuthAuthorizationResult $result, ?string $connectionId = null): RedirectResponse
    {
        return redirect('/integrations?'.http_build_query(array_filter(['google' => $result->value, 'connection' => $connectionId])))
            ->withHeaders(['Referrer-Policy' => 'no-referrer']);
    }
}
