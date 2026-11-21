<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;

final class ResendEmailVerificationAction
{
    public function handle(User $actor): bool
    {
        if ($actor->hasVerifiedEmail()) {
            return false;
        }
        $actor->sendEmailVerificationNotification();

        return true;
    }
}
