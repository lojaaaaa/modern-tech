<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Controllers;

use App\Modules\Integrations\Actions\ConnectMailCloudAction;
use App\Modules\Integrations\Actions\DisconnectCloudConnectionAction;
use App\Modules\Integrations\Exceptions\CloudAuthorizationRequired;
use App\Modules\Integrations\Exceptions\CloudOAuthNotConfigured;
use App\Modules\Integrations\Http\Requests\ConnectMailCloudRequest;
use App\Modules\Integrations\Http\Requests\DisconnectCloudConnectionRequest;
use App\Modules\Integrations\Http\Requests\ListCloudFilesRequest;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Queries\ListCloudConnectionsQuery;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\ProviderFactory;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ConnectionController
{
    public function index(Request $request, ListCloudConnectionsQuery $query): JsonResponse
    {
        return response()->json(['data' => $query->handle($request->user())]);
    }

    public function store(ConnectMailCloudRequest $request, ConnectMailCloudAction $action): JsonResponse
    {
        return response()->json(['data' => $action->handle($request->user(), $request->getData())], 201);
    }

    #[Response(type: 'array{data: list<array{name: string, path: string, type: \App\Modules\Integrations\Enums\CloudEntryType, size: int}>}')]
    public function files(
        ListCloudFilesRequest $request,
        CloudConnection $connection,
        ProviderFactory $providers,
    ): JsonResponse {
        try {
            return response()->json(['data' => $providers->for($connection)->files($request->getPath())]);
        } catch (CloudAuthorizationRequired $error) {
            abort(422, $error->recoveryMessage());
        } catch (CloudOAuthNotConfigured) {
            abort(503);
        } catch (CloudFailure | ConnectionException | LockTimeoutException) {
            abort(502, 'Облачный сервис временно недоступен. Повторите запрос позже.');
        }
    }

    public function disconnect(
        DisconnectCloudConnectionRequest $request,
        CloudConnection $connection,
        DisconnectCloudConnectionAction $action,
    ): JsonResponse {
        $action->handle($connection);

        return response()->json(['data' => null]);
    }
}
