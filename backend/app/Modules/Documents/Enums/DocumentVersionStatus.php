<?php

declare(strict_types=1);

namespace App\Modules\Documents\Enums;

enum DocumentVersionStatus: string
{
    case QUARANTINED = 'quarantined';
    case SCANNING = 'scanning';
    case EXTRACTING = 'extracting';
    case RECOGNIZING = 'recognizing';
    case INDEXING = 'indexing';
    case READY = 'ready';
    case FAILED = 'failed';
    case REJECTED = 'rejected';
    case CANCELLED = 'cancelled';
}
