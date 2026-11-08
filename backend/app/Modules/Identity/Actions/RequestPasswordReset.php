<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use Illuminate\Contracts\Auth\PasswordBroker;

final class RequestPasswordReset
{
    public function __construct(private PasswordBroker $passwords) {}

    public function handle(string $email): void
    {
        $this->passwords->sendResetLink(['email' => $email, 'active' => true]);
    }
}
