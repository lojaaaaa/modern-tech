<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Enums;

enum CloudEntryType: string
{
    case FILE = 'file';
    case DIR = 'dir';
}
