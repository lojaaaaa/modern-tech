<?php

declare(strict_types=1);

namespace App\Modules\Documents\Enums;

enum OfficeFileExtension: string
{
    case DOCX = 'docx';
    case XLSX = 'xlsx';
    case PPTX = 'pptx';
}
