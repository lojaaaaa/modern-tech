<?php

declare(strict_types=1);

namespace App\Modules\Documents\Enums;

enum PreviewKind: string
{
    case IMAGE = 'image';
    case PDF = 'pdf';
    case TEXT = 'text';
}
