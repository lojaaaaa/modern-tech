<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Enums;

enum YandexAuthorizationResult: string
{
    case CONNECTED = 'connected';
    case CANCELLED = 'cancelled';
    case EXPIRED = 'expired';
    case FAILED = 'failed';
}
