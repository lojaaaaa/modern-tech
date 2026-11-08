<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Validation\ValidationException;

final class AuthenticateUser
{
    public function __construct(private StatefulGuard $guard, private RateLimiter $limiter) {}

    public function handle(string $email, string $password, string $clientAddress): User
    {
        $key = 'login:'.hash('sha256', $email.'|'.$clientAddress);
        if ($this->limiter->tooManyAttempts($key, 5)) {
            abort(429, 'Слишком много попыток. Попробуйте через минуту.', ['Retry-After' => (string) $this->limiter->availableIn($key)]);
        }
        if (! $this->guard->attempt(['email' => $email, 'password' => $password, 'active' => true])) {
            $this->limiter->hit($key, 60);
            throw ValidationException::withMessages(['email' => 'Неверный email или пароль.']);
        }
        $this->limiter->clear($key);
        $user = $this->guard->user();
        assert($user instanceof User);

        return $user;
    }
}
