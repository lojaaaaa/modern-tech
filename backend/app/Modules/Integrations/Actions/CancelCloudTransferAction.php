<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Actions;

use App\Modules\Integrations\Enums\CloudTransferStatus;
use App\Modules\Integrations\Models\CloudTransfer;

final class CancelCloudTransferAction
{
    public function handle(CloudTransfer $transfer): CloudTransfer
    {
        $cancelled = CloudTransfer::query()
            ->whereKey($transfer->id)
            ->where('status', CloudTransferStatus::QUEUED)
            ->update(['status' => CloudTransferStatus::CANCELLED]);

        abort_unless($cancelled === 1, 409, 'Операция уже началась.');

        return $transfer->refresh();
    }
}
