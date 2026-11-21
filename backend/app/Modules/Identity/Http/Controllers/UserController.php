<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Models\User;
use App\Modules\Identity\Actions\CreateManagedUserAction;
use App\Modules\Identity\Actions\UpdateManagedUserAction;
use App\Modules\Identity\Http\Requests\CreateManagedUserRequest;
use App\Modules\Identity\Http\Requests\ListUsersRequest;
use App\Modules\Identity\Http\Requests\UpdateManagedUserRequest;
use App\Modules\Identity\Queries\ListManagedUsersQuery;
use Illuminate\Http\JsonResponse;
use Illuminate\Pagination\CursorPaginator;

final class UserController
{
    /** @return CursorPaginator<int, User> */
    public function index(ListUsersRequest $request, ListManagedUsersQuery $users): CursorPaginator
    {
        return $users->handle($request->getFilters())->withQueryString();
    }

    public function store(CreateManagedUserRequest $request, CreateManagedUserAction $action): JsonResponse
    {
        $user = $action->handle($request->user(), $request->getData());

        return response()->json(['data' => $user], 201);
    }

    public function update(UpdateManagedUserRequest $request, User $user, UpdateManagedUserAction $action): JsonResponse
    {
        return response()->json(['data' => $action->handle($request->user(), $user, $request->getData())]);
    }
}
