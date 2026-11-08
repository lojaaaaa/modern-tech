<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use Illuminate\Contracts\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Facades\Gate;

final class UpdateManagedUser
{
    public function __construct(private DatabaseManager $database, private AdministrationLock $lock, private Repository $config) {}

    /** @param array{name?: string, role?: string, active?: bool} $changes */
    public function handle(int $actorId, int $targetId, array $changes): User
    {
        return $this->database->transaction(function () use ($actorId, $targetId, $changes): User {
            $this->lock->acquire();
            $users = User::whereIn('id', [$actorId, $targetId])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $actor = $users->get($actorId) ?? abort(403);
            $target = $users->get($targetId) ?? abort(404);
            Gate::forUser($actor)->authorize('update', $target);

            $newRole = $changes['role'] ?? $target->role;
            $newActive = $changes['active'] ?? $target->active;
            if ($target->isAdministrator() && ($newRole !== 'admin' || ! $newActive)) {
                abort_if(User::where('role', 'admin')->where('active', true)->count() <= 1, 409, 'Нельзя отключить последнего администратора.');
            }
            $oldRole = $target->role;
            $oldActive = $target->active;
            $target->update($changes);
            Audit::record($actorId, 'user.updated', (string) $targetId, [
                'old_role' => $oldRole, 'new_role' => $target->role,
                'old_active' => $oldActive, 'new_active' => $target->active,
            ]);
            if (! $target->active && $this->config->get('session.driver') === 'database') {
                $this->database->connection($this->config->get('session.connection'))
                    ->table($this->config->get('session.table', 'sessions'))->where('user_id', $targetId)->delete();
            }

            return $target->fresh();
        }, 3);
    }
}
