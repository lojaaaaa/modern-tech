<?php

declare(strict_types=1);

namespace App\Modules\Audit\Http\Controllers;

use App\Modules\Audit\Http\Requests\ListAuditEventsRequest;
use App\Modules\Audit\Queries\ListAuditEventsQuery;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Pagination\CursorPaginator;
use stdClass;

final class AuditController
{
    /** @return CursorPaginator<int, stdClass> */
    #[QueryParameter('cursor', type: 'string')]
    public function index(ListAuditEventsRequest $request, ListAuditEventsQuery $events): CursorPaginator
    {
        return $events->handle($request->getFilters())->withQueryString();
    }
}
