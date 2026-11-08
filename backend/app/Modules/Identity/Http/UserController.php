<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Models\User;
use App\Modules\Identity\Actions\CreateManagedUser;
use App\Modules\Identity\Actions\UpdateManagedUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class UserController
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', User::class);

        $data = $request->validate(['page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $users = User::orderBy('name')->orderBy('id')->paginate($data['per_page'] ?? 20);

        return response()->json(['data' => $users->items(), 'meta' => [
            'current_page' => $users->currentPage(), 'last_page' => $users->lastPage(),
            'per_page' => $users->perPage(), 'total' => $users->total(),
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
