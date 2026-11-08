<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Models\User;
use App\Modules\Identity\Actions\CreateManagedUser;
use App\Modules\Identity\Actions\UpdateManagedUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\Cursor;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class UserController
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', User::class);

        $data = $request->validate([
            'cursor' => 'nullable|string|max:2000', 'per_page' => 'sometimes|integer|min:1|max:100',
            'q' => 'nullable|string|max:200', 'role' => ['nullable', Rule::in(['admin', 'employee', 'observer'])],
            'active' => 'nullable|boolean', 'sort' => ['nullable', Rule::in(['name', 'email', 'created_at', 'id'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);
        $sort = $data['sort'] ?? 'name';
        $direction = $data['direction'] ?? 'asc';
        $cursor = null;
        if (! empty($data['cursor'])) {
            $cursor = Cursor::fromEncoded($data['cursor']);
            $values = $cursor?->toArray() ?? [];
            if (($values['_sort'] ?? null) !== $sort || ($values['_direction'] ?? null) !== $direction) {
                throw ValidationException::withMessages(['cursor' => 'Сортировка изменилась. Начните список заново.']);
            }
            if (! is_bool($values['_pointsToNextItems'] ?? null) || ! isset($values[$sort], $values['id']) || ! is_scalar($values[$sort]) || ! ctype_digit((string) $values['id'])) {
                throw ValidationException::withMessages(['cursor' => 'Некорректный курсор. Начните список заново.']);
            }
        }
        if ($cursor && $sort === 'created_at' && ! strtotime((string) $values[$sort])) {
            throw ValidationException::withMessages(['cursor' => 'Некорректный курсор.']);
        }
        $query = User::query();
        if (isset($data['q']) && trim($data['q']) !== '') {
            $term = '%'.strtolower(trim($data['q'])).'%';
            $query->where(fn ($query) => $query->whereRaw('LOWER(name) LIKE ?', [$term])->orWhereRaw('LOWER(email) LIKE ?', [$term]));
        }
        if (isset($data['role'])) {
            $query->where('role', $data['role']);
        }
        if (isset($data['active'])) {
            $query->where('active', $data['active']);
        }
        $query->orderBy($sort, $direction);
        if ($sort !== 'id') {
            $query->orderBy('id', $direction);
        }
        $users = $query->cursorPaginate($data['per_page'] ?? 20, ['*'], 'cursor', $cursor);

        return response()->json(['data' => $users->items(), 'meta' => [
            'next_cursor' => $users->nextCursor() ? (new Cursor(array_merge($users->nextCursor()->toArray(), ['_sort' => $sort, '_direction' => $direction])))->encode() : null,
            'prev_cursor' => $users->previousCursor() ? (new Cursor(array_merge($users->previousCursor()->toArray(), ['_sort' => $sort, '_direction' => $direction]), false))->encode() : null,
            'per_page' => $users->perPage(),
        ]]);
    }

    public function store(Request $request, CreateManagedUser $create): JsonResponse
    {
        Gate::authorize('create', User::class);
        if (is_string($request->input('email'))) {
            $request->merge(['email' => Str::lower(trim($request->input('email')))]);
        }
        $data = $request->validate(['name' => 'required|string|max:120', 'email' => 'required|email|unique:users|max:255', 'password' => 'required|string|min:12|max:128', 'role' => ['required', Rule::in(['admin', 'employee', 'observer'])]]);
        $user = $create->handle($request->user()->id, $data['name'], $data['email'], $data['password'], $data['role']);

        return response()->json(['data' => $user], 201);
    }

    public function update(Request $request, User $user, UpdateManagedUser $update): JsonResponse
    {
        Gate::authorize('update', $user);
        $data = $request->validate(['name' => 'sometimes|string|max:120', 'role' => ['sometimes', Rule::in(['admin', 'employee', 'observer'])], 'active' => 'sometimes|boolean']);

        return response()->json(['data' => $update->handle($request->user()->id, $user->id, $data)]);
    }
}
