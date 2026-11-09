<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http;

use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\ProviderFactory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

final class ConnectionController
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => CloudConnection::where('owner_id', $request->user()->id)->latest()->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_if($request->user()->role === 'observer', 403);
        abort_if($request->input('provider') === 'yandex', 422, 'Подключите Яндекс Диск через авторизацию в Яндексе.');
        $data = $request->validate(['provider' => ['required', Rule::in(['mail'])], 'name' => 'required|string|max:100', 'email' => 'required|email|max:255', 'password' => 'required|string|max:4096']);
        $credentials = ['email' => $data['email'], 'password' => $data['password']];

        return response()->json(['data' => CloudConnection::create(['owner_id' => $request->user()->id, 'provider' => $data['provider'], 'name' => $data['name'], 'credentials' => $credentials])->refresh()], 201);
    }

    public function files(Request $request, CloudConnection $connection, ProviderFactory $providers): JsonResponse
    {
        abort_unless($connection->owner_id === $request->user()->id && $connection->status !== 'disconnected', 404);
        $data = $request->validate(['path' => 'nullable|string|max:2048']);
        try {
            return response()->json(['data' => $providers->for($connection)->files($data['path'] ?? '/')]);
        } catch (\Throwable $error) {
            if ($error instanceof CloudFailure && $error->getMessage() === 'AUTHORIZATION_REQUIRED') {
                abort(422, $connection->provider === 'yandex'
                    ? 'Доступ к Яндекс Диску истёк или отозван. Подключите диск заново через Яндекс.'
                    : 'Mail отклонил данные доступа. Проверьте почту и пароль приложения с доступом к Облаку.');
            }
            if ($error instanceof CloudFailure && $error->getMessage() === 'OAUTH_NOT_CONFIGURED') {
                abort(503, 'Подключение Яндекс Диска пока недоступно. Обратитесь к администратору.');
            }
            abort(502, 'Облачный сервис временно недоступен. Повторите запрос позже.');
        }
    }

    public function disconnect(Request $request, CloudConnection $connection): JsonResponse
    {
        abort_unless($connection->owner_id === $request->user()->id, 404);
        DB::transaction(function () use ($connection): void {
            $locked = CloudConnection::whereKey($connection->id)->lockForUpdate()->firstOrFail();
            $locked->update(['credentials' => [], 'status' => 'disconnected']);
            CloudTransfer::where('connection_id', $connection->id)->where('status', 'queued')->update(['status' => 'cancelled']);
        });

        return response()->json(['data' => null]);
    }
}
