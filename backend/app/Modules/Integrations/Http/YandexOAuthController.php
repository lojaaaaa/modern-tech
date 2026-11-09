<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http;

use App\Models\User;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\YandexOAuth;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

final class YandexOAuthController
{
    public function availability(YandexOAuth $oauth): JsonResponse
    {
        return response()->json(['data' => ['available' => $oauth->configured()]]);
    }

    public function start(Request $request, YandexOAuth $oauth): JsonResponse
    {
        abort_if($request->user()->role === 'observer', 403);
        $data = $request->validate(['connection_id' => 'nullable|uuid']);
        $connection = isset($data['connection_id'])
            ? CloudConnection::where('owner_id', $request->user()->id)->where('provider', 'yandex')->findOrFail($data['connection_id'])
            : null;
        abort_unless($oauth->configured(), 503, 'Подключение Яндекс Диска пока недоступно. Обратитесь к администратору.');

        return response()->json(['data' => ['url' => $oauth->authorizationUrl($request->user(), $request->session()->getId(), $connection)]]);
    }

    public function callback(Request $request, YandexOAuth $oauth): RedirectResponse
    {
        $user = $request->user();
        $user = $user instanceof User ? $user->fresh() : null;
        $state = $request->query('state');
        if (! $user || ! $user->active || $user->role === 'observer' || ! is_string($state)) {
            return $this->back('expired');
        }
        try {
            $pending = $oauth->consumeState($user, $request->session()->getId(), $state);
            if ($request->query('error') === 'access_denied') {
                return $this->back('cancelled');
            }
            $code = $request->query('code');
            if ($request->has('error') || ! is_string($code) || $code === '' || strlen($code) > 4096) {
                return $this->back('failed');
            }
            $connection = $oauth->connect($user, $code, $pending);

            return $this->back('connected', $connection->id);
        } catch (CloudFailure $error) {
            return $this->back($error->getMessage() === 'OAUTH_STATE_INVALID' ? 'expired' : 'failed');
        } catch (LockTimeoutException) {
            return $this->back('failed');
        }
    }

    private function back(string $result, ?string $connectionId = null): RedirectResponse
    {
        return redirect('/integrations?'.http_build_query(array_filter(['yandex' => $result, 'connection' => $connectionId])))
            ->withHeaders(['Referrer-Policy' => 'no-referrer']);
    }
}
