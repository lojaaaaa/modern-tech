<?php

declare(strict_types=1);

namespace App\Modules\Documents\Rules;

use App\Modules\Documents\DTO\IncomingFile;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Symfony\Component\HttpFoundation\File\File;
use Symfony\Component\HttpFoundation\File\UploadedFile;

final class DocumentFile implements ValidationRule
{
    public const FORMATS = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg'];

    private const MAX_BYTES = 50 * 1024 * 1024;

    private const MAX_IMAGE_PIXELS = 40_000_000;

    private const TEXT_MIMES = ['text/plain', 'text/csv', 'text/markdown', 'application/csv'];

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value instanceof UploadedFile) {
            $value = new IncomingFile($value->getPathname(), $value->getClientOriginalName());
        }

        $violation = $value instanceof IncomingFile
            ? $this->getViolation($value)
            : 'documents.unsupported_file_format';

        if ($violation !== null) {
            $fail($violation)->translate();
        }
    }

    private function getViolation(IncomingFile $incoming): ?string
    {
        $file = $incoming->file;
        $size = $file->getSize();
        if ($size === false || $size < 1 || $size > self::MAX_BYTES) {
            return 'documents.invalid_file_size';
        }

        $extension = $incoming->extension();

        return match ($extension) {
            'txt', 'md', 'csv' => in_array($file->getMimeType(), self::TEXT_MIMES, true) ? null : 'documents.invalid_text',
            'pdf' => $file->getMimeType() === 'application/pdf' ? null : 'documents.invalid_pdf',
            'png', 'jpg', 'jpeg' => $this->isSupportedImage($file, $extension) ? null : 'documents.invalid_image',
            'docx', 'xlsx', 'pptx' => new OfficePackage()->validationError($file->getPathname(), $extension),
            default => 'documents.unsupported_file_format',
        };
    }

    private function isSupportedImage(File $file, string $extension): bool
    {
        $expectedMime = $extension === 'png' ? 'image/png' : 'image/jpeg';
        if ($file->getMimeType() !== $expectedMime) {
            return false;
        }

        $dimensions = @getimagesize($file->getPathname());
        if ($dimensions === false || $dimensions['mime'] !== $expectedMime) {
            return false;
        }

        [$width, $height] = $dimensions;

        return $width > 0 && $height > 0 && $width <= intdiv(self::MAX_IMAGE_PIXELS, $height);
    }
}
