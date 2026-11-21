<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Enums;

enum CloudProviderId: string
{
    case MAIL = 'mail';
    case YANDEX = 'yandex';
}
