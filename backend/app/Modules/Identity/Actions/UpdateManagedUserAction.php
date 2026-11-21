<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Identity\DTO\UpdateManagedUserData;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

final class UpdateManagedUserAction
{
    public function __construct(private DestroyUserSessionsAction $sessions)
    {
    }

    public function handle(User $actor, User $target, UpdateManagedUserData $data): User
    {
        return DB::transaction(function () use ($actor, $target, $data): User {
            $users = User::query()
                ->whereKey([$actor->id, $target->id])
                ->orWhere(fn (Builder $query) => $query->where('role', UserRole::ADMIN)->where('active', true))
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');
            $actor = $users->get($actor->id) ?? abort(403);
            $target = $users->get($target->id) ?? abort(404);

            $target->fill($data->toArray());
            if (
                $target->getOriginal('role') === UserRole::ADMIN
                && $target->getOriginal('active')
                && ! $target->isAdministrator()
            ) {
                abort_unless(
                    $users->contains(fn (User $user) => $user->isAdministrator()),
                    409,
                    __('identity.last_administrator'),
                );
            }

            AuditWriter::record(
                $actor->id,
                'user.updated',
                (string) $target->id,
                [
                    'old_role' => $target->getOriginal('role')->value,
                    'new_role' => $target->role->value,
                    'old_active' => $target->getOriginal('active'),
                    'new_active' => $target->isActive(),
                ],
            );

            $target->save();

            if (! $target->isActive()) {
                $this->sessions->handle($target);
            }

            return $target;
        }, attempts: 3);
    }
}
