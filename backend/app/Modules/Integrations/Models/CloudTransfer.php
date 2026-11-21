<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Models;

use App\Models\User;
use App\Modules\Integrations\Enums\CloudTransferStatus;
use App\Modules\Integrations\Enums\TransferDirection;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class CloudTransfer extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['status' => CloudTransferStatus::class, 'direction' => TransferDirection::class];
    }

    /** @param Builder<self> $query */
    #[Scope]
    protected function initiatedBy(Builder $query, User $user): void
    {
        $query->where('initiator_id', $user->id);
    }
}
