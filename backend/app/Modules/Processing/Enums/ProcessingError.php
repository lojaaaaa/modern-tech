<?php

declare(strict_types=1);

namespace App\Modules\Processing\Enums;

enum ProcessingError: string
{
    case FILE_INFECTED = 'FILE_INFECTED';
    case SCAN_FAILED = 'SCAN_FAILED';
    case SCANNER_UNAVAILABLE = 'SCANNER_UNAVAILABLE';
    case ORIGINAL_UNAVAILABLE = 'ORIGINAL_UNAVAILABLE';
    case EXTRACTION_FAILED = 'EXTRACTION_FAILED';
    case EXTRACTED_TEXT_TOO_LARGE = 'EXTRACTED_TEXT_TOO_LARGE';
    case PROCESSING_FAILED = 'PROCESSING_FAILED';
    case PREVIEW_UNAVAILABLE = 'PREVIEW_UNAVAILABLE';
    case PREVIEW_TOO_LARGE = 'PREVIEW_TOO_LARGE';
    case PREVIEW_CONVERSION_FAILED = 'PREVIEW_CONVERSION_FAILED';
    case PREVIEW_WRITE_FAILED = 'PREVIEW_WRITE_FAILED';
    case PREVIEW_FAILED = 'PREVIEW_FAILED';

    public function isRetryable(): bool
    {
        return match ($this) {
            self::FILE_INFECTED, self::EXTRACTED_TEXT_TOO_LARGE => false,
            default => true,
        };
    }
}
