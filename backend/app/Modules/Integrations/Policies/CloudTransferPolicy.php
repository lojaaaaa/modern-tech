<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Policies;

use App\Models\User;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Enums\TransferDirection;
use App\Modules\Integrations\Models\CloudTransfer;
use Illuminate\Auth\Access\Response;

final class CloudTransferPolicy
{
    public function __construct(private readonly DocumentPolicy $documents)
    {
    }

    public function create(User $user, ?TransferDirection $direction = null): Response
    {
        if (! $user->isActive() || $user->role === UserRole::OBSERVER) {
            return Response::deny('');
        }

        if ($direction === TransferDirection::IMPORT && $this->documents->create($user)->denied()) {
            return Response::deny('Подтвердите электронную почту перед импортом документов.');
        }

        return Response::allow();
    }

    public function cancel(User $user, CloudTransfer $transfer): Response
    {
        return $transfer->initiator_id === $user->id
            ? Response::allow()
            : Response::denyAsNotFound('Запрос отклонён.');
    }
}
