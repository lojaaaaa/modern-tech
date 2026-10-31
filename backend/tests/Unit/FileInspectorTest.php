<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Documents\Services\FileInspector;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class FileInspectorTest extends TestCase
{
    public function test_fake_office_container_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        (new FileInspector)->inspect(UploadedFile::fake()->createWithContent('bad.docx', 'not an office archive'));
    }

    public function test_fake_image_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        (new FileInspector)->inspect(UploadedFile::fake()->createWithContent('bad.png', 'not an image'));
    }
}
