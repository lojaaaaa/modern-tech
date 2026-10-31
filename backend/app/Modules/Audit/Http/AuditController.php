<?php

declare(strict_types=1);

namespace App\Modules\Audit\Http;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AuditController
{
    public function index(Request $request)
    {
        abort_unless($request->user()->isAdministrator(), 403);
        $data = $request->validate(['page' => 'nullable|integer|min:1']);

        return DB::table('audit_events')->leftJoin('users', 'users.id', '=', 'audit_events.actor_id')
            ->leftJoin('documents', fn ($join) => $join->on(DB::raw('CAST(documents.id AS VARCHAR)'), '=', 'audit_events.resource_id'))
            ->select(['audit_events.id', 'audit_events.action', 'audit_events.actor_id', 'audit_events.resource_id', 'audit_events.created_at', 'users.name as actor_name', 'documents.title as resource_name'])
            ->orderByDesc('audit_events.created_at')->orderByDesc('audit_events.id')->paginate(12);
    }
}
