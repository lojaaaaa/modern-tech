<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Policies;

use App\Models\User;
use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Enums\CloudConnectionStatus;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Auth\Access\Response;

final class CloudConnectionPolicy
{
    public function create(User $user): Response
    {
        return $user->isActive() && $user->role !== UserRole::OBSERVER
            ? Response::allow()
            : Response::deny('');
    }

    public function listFiles(User $user, CloudConnection $connection): Response
    {
        return CloudProviderId::tryFrom($connection->provider) !== null && $connection->isOwnedBy($user) && $connection->status !== CloudConnectionStatus::DISCONNECTED
            ? Response::allow()
            : Response::denyAsNotFound('Запрос отклонён.');
    }

    public function disconnect(User $user, CloudConnection $connection): Response
    {
        return $connection->isOwnedBy($user)
            ? Response::allow()
            : Response::denyAsNotFound('Запрос отклонён.');
    }

    public function transfer(User $user, CloudConnection $connection): bool
    {
        return CloudProviderId::tryFrom($connection->provider) !== null && $connection->isOwnedBy($user) && $connection->status === CloudConnectionStatus::CONNECTED;
    }
}
