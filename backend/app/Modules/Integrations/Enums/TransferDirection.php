<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Enums;

enum TransferDirection: string
{
    case IMPORT = 'import';
    case EXPORT = 'export';
}
