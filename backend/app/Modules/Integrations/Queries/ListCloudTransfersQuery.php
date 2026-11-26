<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Queries;

use App\Models\User;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use Illuminate\Database\Eloquent\Collection;

final class ListCloudTransfersQuery
{
    /** @return Collection<int, CloudTransfer> */
    public function handle(User $user): Collection
    {
        return CloudTransfer::query()->initiatedBy($user)->whereIn('connection_id', CloudConnection::query()->select('id')->whereIn('provider', array_column(CloudProviderId::cases(), 'value')))->latest()->limit(100)->get();
    }
}
