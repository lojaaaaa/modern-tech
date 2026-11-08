<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Facades\Gate;

final class CreateManagedUser
{
    public function __construct(private DatabaseManager $database, private AdministrationLock $lock) {}

    public function handle(int $actorId, string $name, string $email, string $password, string $role): User
    {
        return $this->database->transaction(function () use ($actorId, $name, $email, $password, $role): User {
            $this->lock->acquire();
            $actor = User::whereKey($actorId)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('create', User::class);
            $user = User::create(compact('name', 'email', 'password', 'role'));
            Audit::record($actor->id, 'user.created', (string) $user->id, ['role' => $user->role]);

            return $user;
        }, 3);
    }
}
