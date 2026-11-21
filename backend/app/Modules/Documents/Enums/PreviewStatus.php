<?php

declare(strict_types=1);

namespace App\Modules\Documents\Enums;

enum PreviewStatus: string
{
    case READY = 'ready';
    case FAILED = 'failed';
    case PENDING = 'pending';
}
