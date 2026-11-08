<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;

final class ResendEmailVerification
{
    public function handle(User $actor): bool
    {
        abort_unless($actor->active, 403, 'Учётная запись недоступна.');
        if ($actor->hasVerifiedEmail()) {
            return false;
        }
        $actor->sendEmailVerificationNotification();

        return true;
    }
}
