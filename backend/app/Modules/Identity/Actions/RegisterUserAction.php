<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Identity\DTO\RegisterUserData;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class RegisterUserAction
{
    public function handle(RegisterUserData $data): User
    {
        try {
            return DB::transaction(function () use ($data): User {
                $user = User::query()->create([
                    'name' => $data->name,
                    'email' => $data->email,
                    'password' => $data->password,
                    'role' => UserRole::EMPLOYEE,
                    'active' => true,
                ]);

                AuditWriter::record(
                    $user->id,
                    'user.registered',
                    (string) $user->id,
                );

                return $user->refresh();
            }, attempts: 3);
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'email' => __('identity.email_in_use'),
            ]);
        }
    }
}
