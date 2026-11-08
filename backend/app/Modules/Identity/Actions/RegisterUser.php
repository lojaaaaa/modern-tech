<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Validation\ValidationException;

final class RegisterUser
{
    public function __construct(private ConnectionInterface $database) {}

    public function handle(string $name, string $email, string $password): User
    {
        try {
            $user = $this->database->transaction(function () use ($name, $email, $password): User {
                $user = User::create(['name' => $name, 'email' => $email, 'password' => $password, 'role' => 'employee', 'active' => true]);
                Audit::record($user->id, 'user.registered', (string) $user->id);

                return $user->refresh();
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['email' => 'Этот email уже используется.']);
        }
        $user->sendEmailVerificationNotification();

        return $user;
    }
}
