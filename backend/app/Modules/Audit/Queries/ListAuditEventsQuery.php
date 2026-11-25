<?php

declare(strict_types=1);

namespace App\Modules\Audit\Queries;

use App\Modules\Audit\DTO\AuditListFilters;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Pagination\CursorPaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

final class ListAuditEventsQuery
{
    /** @return CursorPaginator<int, stdClass> */
    public function handle(AuditListFilters $filters): CursorPaginator
    {
        $events = DB::table('audit_events')
            ->leftJoin('users', 'users.id', '=', 'audit_events.actor_id')
            ->leftJoin('documents', fn (JoinClause $join) => $join->on(
                DB::raw('CAST(documents.id AS VARCHAR)'),
                '=',
                'audit_events.resource_id',
            ))
            ->leftJoin('users as subject', fn (JoinClause $join) => $join
                ->on(DB::raw('CAST(subject.id AS VARCHAR)'), '=', 'audit_events.resource_id')
                ->where('audit_events.action', 'like', 'user.%'))
            ->select([
                'audit_events.id',
                'audit_events.action',
                'audit_events.actor_id',
                'audit_events.resource_id',
                'audit_events.created_at',
                'users.name as actor_name',
            ])
            ->selectRaw("COALESCE(audit_events.metadata->>'resource_name', documents.title, subject.name) AS resource_name")
            ->selectRaw(<<<'SQL'
                CASE
                    WHEN audit_events.action = 'user.updated' AND
                         audit_events.metadata->>'old_active' <> audit_events.metadata->>'new_active'
                        THEN CASE WHEN CAST(audit_events.metadata->>'new_active' AS VARCHAR) IN ('1', 'true')
                                  THEN 'user.unblocked' ELSE 'user.blocked' END
                    WHEN audit_events.action = 'user.updated' AND
                         audit_events.metadata->>'old_role' <> audit_events.metadata->>'new_role'
                        THEN 'user.role_changed'
                    ELSE audit_events.action
                END AS display_action
                SQL);

        return DB::query()->fromSub($events, 'events')
            ->when($filters->search !== null, fn (Builder $query) => $query->where(
                fn (Builder $query) => $query->whereLike('actor_name', "%{$filters->search}%")
                    ->orWhereLike('resource_name', "%{$filters->search}%")
                    ->orWhereLike('resource_id', "%{$filters->search}%"),
            ))
            ->when($filters->action !== null, fn (Builder $query) => $query->where('action', $filters->action))
            ->when($filters->actorId !== null, fn (Builder $query) => $query->where('actor_id', $filters->actorId))
            ->when($filters->dateFrom !== null, fn (Builder $query) => $query->where(
                'created_at',
                '>=',
                $filters->dateFrom . ' 00:00:00',
            ))
            ->when($filters->dateTo !== null, fn (Builder $query) => $query->where(
                'created_at',
                '<',
                CarbonImmutable::parse($filters->dateTo)->addDay(),
            ))
            ->orderBy($filters->sort, $filters->direction)
            ->when($filters->sort !== 'id', fn (Builder $query) => $query->orderBy('id', $filters->direction))
            ->cursorPaginate(perPage: $filters->perPage);
    }
}
