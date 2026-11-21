<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Identity\DTO\CreateManagedUserData;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class CreateManagedUserAction
{
    public function handle(User $actor, CreateManagedUserData $data): User
    {
        try {
            return DB::transaction(function () use ($actor, $data): User {
                $actor = User::query()
                    ->whereKey($actor->id)
                    ->lockForUpdate()
                    ->firstOrFail();
                $user = User::query()->create($data->toArray());

                AuditWriter::record(
                    $actor->id,
                    'user.created',
                    (string) $user->id,
                    [
                        'role' => $user->role->value,
                    ],
                );

                return $user;
            }, attempts: 3);
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'email' => __('identity.email_in_use'),
            ]);
        }
    }
}
