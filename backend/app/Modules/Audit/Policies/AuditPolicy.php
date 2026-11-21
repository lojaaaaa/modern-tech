<?php

declare(strict_types=1);

namespace App\Modules\Audit\Policies;

use App\Models\User;
use Illuminate\Auth\Access\Response;

final class AuditPolicy
{
    public function view(User $user): Response
    {
        return $user->isAdministrator() ? Response::allow() : Response::deny();
    }
}
