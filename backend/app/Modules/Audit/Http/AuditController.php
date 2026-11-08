<?php

declare(strict_types=1);

namespace App\Modules\Audit\Http;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\Cursor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class AuditController
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()->isAdministrator(), 403);
        $data = $request->validate([
            'cursor' => 'nullable|string|max:2000', 'per_page' => 'sometimes|integer|min:1|max:100',
            'q' => 'nullable|string|max:200', 'action' => 'nullable|string|max:100', 'actor_id' => 'nullable|integer|min:1',
            'date_from' => 'nullable|date_format:Y-m-d', 'date_to' => 'nullable|date_format:Y-m-d|after_or_equal:date_from',
            'sort' => ['nullable', Rule::in(['created_at', 'id', 'action'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);
        $sort = $data['sort'] ?? 'created_at';
        $direction = $data['direction'] ?? 'desc';
        $cursor = null;
        if (! empty($data['cursor'])) {
            $cursor = Cursor::fromEncoded($data['cursor']);
            $values = $cursor?->toArray() ?? [];
            if (($values['_sort'] ?? null) !== $sort || ($values['_direction'] ?? null) !== $direction) {
                throw ValidationException::withMessages(['cursor' => 'Сортировка изменилась. Начните список заново.']);
            }
            if (! is_bool($values['_pointsToNextItems'] ?? null) || ! isset($values[$sort], $values['id']) || ! is_string($values[$sort]) || ! Str::isUuid($values['id'])) {
                throw ValidationException::withMessages(['cursor' => 'Некорректный курсор. Начните список заново.']);
            }
            if ($sort === 'created_at' && ! strtotime($values[$sort])) {
                throw ValidationException::withMessages(['cursor' => 'Некорректный курсор.']);
            }
        }
        $events = DB::table('audit_events')->leftJoin('users', 'users.id', '=', 'audit_events.actor_id')
            ->leftJoin('documents', fn ($join) => $join->on(DB::raw('CAST(documents.id AS VARCHAR)'), '=', 'audit_events.resource_id'))
            ->select(['audit_events.id', 'audit_events.action', 'audit_events.actor_id', 'audit_events.resource_id', 'audit_events.created_at', 'users.name as actor_name', 'documents.title as resource_name']);
        $query = DB::query()->fromSub($events, 'events');
        if (isset($data['q']) && trim($data['q']) !== '') {
            $term = '%'.strtolower(trim($data['q'])).'%';
            $query->where(fn ($query) => $query->whereRaw('LOWER(actor_name) LIKE ?', [$term])->orWhereRaw('LOWER(resource_name) LIKE ?', [$term])->orWhereRaw('LOWER(resource_id) LIKE ?', [$term]));
        }
        foreach (['action', 'actor_id'] as $field) {
            if (isset($data[$field])) {
                $query->where($field, $data[$field]);
            }
        }
        if (isset($data['date_from'])) {
            $query->where('created_at', '>=', $data['date_from'].' 00:00:00');
        }
        if (isset($data['date_to'])) {
            $query->where('created_at', '<', date('Y-m-d', strtotime($data['date_to'].' +1 day')).' 00:00:00');
        }
        $query->orderBy($sort, $direction);
        if ($sort !== 'id') {
            $query->orderBy('id', $direction);
        }
        $page = $query->cursorPaginate($data['per_page'] ?? 20, ['*'], 'cursor', $cursor);

        return response()->json(['data' => $page->items(), 'meta' => [
            'next_cursor' => $page->nextCursor() ? (new Cursor(array_merge($page->nextCursor()->toArray(), ['_sort' => $sort, '_direction' => $direction])))->encode() : null,
            'prev_cursor' => $page->previousCursor() ? (new Cursor(array_merge($page->previousCursor()->toArray(), ['_sort' => $sort, '_direction' => $direction]), false))->encode() : null,
            'per_page' => $page->perPage(),
        ]]);
    }
}
