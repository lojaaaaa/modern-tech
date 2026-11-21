<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Enums;

enum CloudTransferStatus: string
{
    case QUEUED = 'queued';
    case RUNNING = 'running';
    case COMPLETED = 'completed';
    case FAILED = 'failed';
    case CANCELLED = 'cancelled';
}
