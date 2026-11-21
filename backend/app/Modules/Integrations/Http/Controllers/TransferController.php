<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Controllers;

use App\Modules\Integrations\Actions\CancelCloudTransferAction;
use App\Modules\Integrations\Actions\QueueCloudTransferAction;
use App\Modules\Integrations\Http\Requests\CancelCloudTransferRequest;
use App\Modules\Integrations\Http\Requests\QueueCloudTransferRequest;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Queries\ListCloudTransfersQuery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class TransferController
{
    public function index(Request $request, ListCloudTransfersQuery $query): JsonResponse
    {
        return response()->json(['data' => $query->handle($request->user())]);
    }

    public function store(QueueCloudTransferRequest $request, QueueCloudTransferAction $action): JsonResponse
    {
        return response()->json(['data' => $action->handle($request->user(), $request->getData())], 202);
    }

    public function cancel(
        CancelCloudTransferRequest $request,
        CloudTransfer $transfer,
        CancelCloudTransferAction $action,
    ): JsonResponse {
        return response()->json(['data' => $action->handle($transfer)]);
    }
}
