<?php

declare(strict_types=1);

namespace App\Modules\Identity\Policies;

use App\Models\User;

final class UserPolicy
{
    public function viewAny(User $actor): bool
    {
        return $actor->isAdministrator();
    }

    public function create(User $actor): bool
    {
        return $actor->isAdministrator();
    }

    public function update(User $actor, User $target): bool
    {
        return $actor->isAdministrator();
    }
}
