<?php

declare(strict_types=1);

namespace App\Modules\Audit\Http\Controllers;

use App\Modules\Audit\Http\Requests\ListAuditEventsRequest;
use App\Modules\Audit\Queries\ListAuditEventsQuery;
use Dedoc\Scramble\Attributes\QueryParameter;
use Dedoc\Scramble\Attributes\Response;

final class AuditController
{
    #[Response(type: 'array{data: list<array{id: string, action: string, display_action: string, actor_id: ?int, actor_name: ?string, resource_id: ?string, resource_name: ?string, created_at: string}>, next_cursor: ?string, prev_cursor: ?string, next_page_url: ?string, prev_page_url: ?string, per_page: int, path: string}')]
    #[QueryParameter('cursor', type: 'string')]
    public function index(ListAuditEventsRequest $request, ListAuditEventsQuery $events): \Illuminate\Http\JsonResponse
    {
        // Materialize cursor links before normalizing presentation timestamps.
        $result = $events->handle($request->getFilters())->withQueryString()->toArray();
        foreach ($result['data'] as $event) {
            $event->created_at = \Carbon\CarbonImmutable::parse($event->created_at, 'UTC')->toIso8601String();
        }
        return response()->json($result);
    }
}
