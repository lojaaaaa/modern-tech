<?php

declare(strict_types=1);

namespace App\Modules\Documents\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;
use ZipArchive;

final class FileInspector
{
    public function inspect(UploadedFile $file): void
    {
        $size = $file->getSize();
        if ($size === false || $size < 1 || $size > 52_428_800) {
            $this->reject('Размер файла должен быть от 1 байта до 50 МиБ.');
        }
        $ext = strtolower($file->getClientOriginalExtension());
        if (in_array($ext, ['txt', 'md', 'csv'], true) && ! in_array($file->getMimeType(), ['text/plain', 'text/csv', 'text/markdown', 'application/csv'], true)) {
            $this->reject('Содержимое не соответствует текстовому файлу.');
        }
        if ($ext === 'pdf' && $file->getMimeType() !== 'application/pdf') {
            $this->reject('Содержимое не соответствует PDF.');
        }
        if (in_array($ext, ['png', 'jpg', 'jpeg'], true)) {
            $dimensions = @getimagesize($file->getPathname());
            if (! $dimensions || $dimensions[0] * $dimensions[1] > 40_000_000) {
                $this->reject('Изображение повреждено или превышает 40 мегапикселей.');
            }
        }
        if (! in_array($ext, ['docx', 'xlsx', 'pptx'], true)) {
            return;
        }
        $zip = new ZipArchive;
        if ($zip->open($file->getPathname()) !== true) {
            $this->reject('Повреждённый документ Office.');
        }
        try {
            if ($zip->numFiles > 10000 || $zip->locateName('[Content_Types].xml') === false) {
                $this->reject('Неподдерживаемая структура Office.');
            }
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->statIndex($i);
                if ($entry === false) {
                    $this->reject('Не удалось прочитать структуру Office.');
                }
                $total += $entry['size'];
                if ($total > 250 * 1024 * 1024 || str_contains(strtolower($entry['name']), 'vbaproject.bin') || str_contains($entry['name'], '../')) {
                    $this->reject('Документ содержит запрещённое содержимое или превышает лимит распаковки.');
                }
            }
        } finally {
            $zip->close();
        }
    }

    private function reject(string $message): never
    {
        throw ValidationException::withMessages(['file' => $message]);
    }
}
