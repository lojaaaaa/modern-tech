<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use Illuminate\Support\Facades\Password;

final class RequestPasswordResetAction
{
    public function handle(string $email): void
    {
        Password::sendResetLink(['email' => $email, 'active' => true]);
    }
}
