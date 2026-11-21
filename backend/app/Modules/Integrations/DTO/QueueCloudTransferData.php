<?php

declare(strict_types=1);

namespace App\Modules\Integrations\DTO;

use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Integrations\Enums\TransferDirection;
use App\Modules\Integrations\Models\CloudConnection;

final readonly class QueueCloudTransferData
{
    public function __construct(
        public CloudConnection $connection,
        public TransferDirection $direction,
        public string $path,
        public string $filename,
        public ?DocumentVersion $version,
        public string $key,
        public string $requestHash,
    ) {
    }
}
