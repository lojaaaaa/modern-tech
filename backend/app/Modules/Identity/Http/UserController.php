<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

final class UserController
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()->isAdministrator(), 403);

        return response()->json(['data' => User::orderBy('name')->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()->isAdministrator(), 403);
        $data = $request->validate(['name' => 'required|string|max:120', 'email' => 'required|email|unique:users|max:255', 'password' => 'required|string|min:12|max:128', 'role' => ['required', Rule::in(['admin', 'employee', 'observer'])]]);
        $user = DB::transaction(function () use ($data, $request) {
            $user = User::create($data);
            Audit::record($request->user()->id, 'user.created', (string) $user->id);

            return $user;
        });

        return response()->json(['data' => $user], 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        abort_unless($request->user()->isAdministrator(), 403);
        $data = $request->validate(['name' => 'sometimes|string|max:120', 'role' => ['sometimes', Rule::in(['admin', 'employee', 'observer'])], 'active' => 'sometimes|boolean']);
        DB::transaction(function () use ($user, $data, $request): void {
            $admins = User::where('role', 'admin')->where('active', true)->lockForUpdate()->get();
            if ($user->isAdministrator() && (($data['role'] ?? 'admin') !== 'admin' || ($data['active'] ?? true) === false)) {
                abort_if($admins->count() <= 1, 409, 'Нельзя отключить последнего администратора.');
            }
            $user->update($data);
            Audit::record($request->user()->id, 'user.updated', (string) $user->id);
            if (! $user->active) {
                DB::table('sessions')->where('user_id', $user->id)->delete();
            }
        });

        return response()->json(['data' => $user->fresh()]);
    }
}
