<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Actions;

use App\Modules\Integrations\Enums\CloudConnectionStatus;
use App\Modules\Integrations\Enums\CloudTransferStatus;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use Illuminate\Support\Facades\DB;

final class DisconnectCloudConnectionAction
{
    public function handle(CloudConnection $connection): void
    {
        DB::transaction(function () use ($connection): void {
            $locked = CloudConnection::query()->whereKey($connection->id)->lockForUpdate()->firstOrFail();
            $locked->update(['credentials' => [], 'status' => CloudConnectionStatus::DISCONNECTED]);

            CloudTransfer::query()
                ->where('connection_id', $locked->id)
                ->where('status', CloudTransferStatus::QUEUED)
                ->update(['status' => CloudTransferStatus::CANCELLED]);
        });
    }
}
