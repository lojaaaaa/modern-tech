<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Queries;

use App\Models\User;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Database\Eloquent\Collection;

final class ListCloudConnectionsQuery
{
    /** @return Collection<int, CloudConnection> */
    public function handle(User $user): Collection
    {
        return CloudConnection::query()->ownedBy($user)->whereIn('provider', array_column(CloudProviderId::cases(), 'value'))->latest()->get();
    }
}
