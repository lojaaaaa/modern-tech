<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Actions;

use App\Models\User;
use App\Modules\Integrations\DTO\ConnectMailCloudData;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;

final class ConnectMailCloudAction
{
    public function handle(User $user, ConnectMailCloudData $data): CloudConnection
    {
        return CloudConnection::query()->create([
            'owner_id' => $user->id,
            'provider' => CloudProviderId::MAIL->value,
            'name' => $data->name,
            'credentials' => ['email' => $data->email, 'password' => $data->password],
        ])->refresh();
    }
}
