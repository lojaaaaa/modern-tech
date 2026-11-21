<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Controllers;

use App\Modules\Documents\Actions\BatchDocumentsAction;
use App\Modules\Documents\Http\Requests\BatchDocumentsRequest;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;

final class BatchController
{
    #[Response(403, description: 'The requested operation is not permitted for every document.')]
    #[Response(404, description: 'A requested document could not be found.')]
    public function store(BatchDocumentsRequest $request, BatchDocumentsAction $action): JsonResponse
    {
        $count = $action->handle($request->user(), $request->getData());

        return response()->json(['data' => ['count' => $count]]);
    }
}
