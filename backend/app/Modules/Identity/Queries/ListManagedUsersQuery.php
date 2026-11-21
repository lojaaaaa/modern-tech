<?php

declare(strict_types=1);

namespace App\Modules\Identity\Queries;

use App\Models\User;
use App\Modules\Identity\DTO\UserListFilters;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\CursorPaginator;

final class ListManagedUsersQuery
{
    /** @return CursorPaginator<int, User> */
    public function handle(UserListFilters $filters): CursorPaginator
    {
        return User::query()
            ->when($filters->search !== null, fn (Builder $query) => $query->where(
                fn (Builder $query) => $query->whereLike('name', "%{$filters->search}%")
                    ->orWhereLike('email', "%{$filters->search}%")
            ))
            ->when($filters->role !== null, fn (Builder $query) => $query->where('role', $filters->role))
            ->when($filters->isActive !== null, fn (Builder $query) => $query->where('active', $filters->isActive))
            ->orderBy($filters->sort, $filters->direction)
            ->when($filters->sort !== 'id', fn (Builder $query) => $query->orderBy('id', $filters->direction))
            ->cursorPaginate(perPage: $filters->perPage, cursor: $filters->cursor);
    }
}
