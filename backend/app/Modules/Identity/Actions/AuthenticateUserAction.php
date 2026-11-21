<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Identity\Exceptions\InvalidLoginCredentials;
use Illuminate\Contracts\Auth\StatefulGuard;

final class AuthenticateUserAction
{
    public function __construct(private StatefulGuard $guard)
    {
    }

    public function handle(string $email, string $password): User
    {
        if (! $this->guard->attempt(['email' => $email, 'password' => $password, 'active' => true])) {
            throw InvalidLoginCredentials::withMessages(['email' => 'Неверный email или пароль.']);
        }

        $user = $this->guard->user();
        assert($user instanceof User);

        return $user;
    }
}
