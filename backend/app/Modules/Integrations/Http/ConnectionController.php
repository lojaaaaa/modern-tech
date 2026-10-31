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
        $data = $request->validate(['provider' => ['required', Rule::in(['yandex', 'mail'])], 'name' => 'required|string|max:100', 'token' => 'required_if:provider,yandex|string|max:4096', 'email' => 'required_if:provider,mail|email|max:255', 'password' => 'required_if:provider,mail|string|max:4096']);
        if ($data['provider'] === 'yandex') {
            abort_if(preg_match('/^[a-f0-9]{32}$/iD', $data['token']) === 1, 422, 'Введён Client ID или Client secret приложения. Нужен OAuth-токен пользователя Яндекс Диска.');
        }
        $credentials = $data['provider'] === 'yandex' ? ['token' => $data['token']] : ['email' => $data['email'], 'password' => $data['password']];

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
                abort(422, 'Яндекс или Mail отклонил данные доступа. Для Яндекса нужен OAuth-токен пользователя с правами Диска, а не Client ID или Client secret. Отключите это подключение и создайте новое с токеном.');
            }
            abort(502, 'Облачный сервис временно недоступен. Повторите запрос позже.');
        }
    }

    public function disconnect(Request $request, CloudConnection $connection): JsonResponse
    {
        abort_unless($connection->owner_id === $request->user()->id, 404);
        DB::transaction(function () use ($connection): void {
            $connection->update(['credentials' => [], 'status' => 'disconnected']);
            CloudTransfer::where('connection_id', $connection->id)->where('status', 'queued')->update(['status' => 'cancelled']);
        });

        return response()->json(['data' => null]);
    }
}
