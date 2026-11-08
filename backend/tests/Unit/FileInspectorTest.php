<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Processing\Services\FileInspector;
use Illuminate\Http\UploadedFile;
use App\Modules\Documents\Services\IncomingFile;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class FileInspectorTest extends TestCase
{
    public function test_fake_office_container_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        $file = UploadedFile::fake()->createWithContent('bad.docx', 'not an office archive');
        $incoming = new IncomingFile($file->getPathname(), 'bad.docx');
        (new FileInspector)->inspect($incoming->file, $incoming->extension());
    }

    public function test_fake_image_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        $file = UploadedFile::fake()->createWithContent('bad.png', 'not an image');
        $incoming = new IncomingFile($file->getPathname(), 'bad.png');
        (new FileInspector)->inspect($incoming->file, $incoming->extension());
    }
}
