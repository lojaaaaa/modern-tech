<?php

declare(strict_types=1);

namespace App\Modules\Documents\Enums;

enum BatchDocumentOperation: string
{
    case TRASH = 'trash';
    case RESTORE = 'restore';
}
