<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Enums;

enum CloudConnectionStatus: string
{
    case CONNECTED = 'connected';
    case AUTHORIZATION_REQUIRED = 'authorization_required';
    case DISCONNECTED = 'disconnected';
}
