<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Documents\DTO\IncomingFile;
use App\Modules\Documents\Rules\DocumentFile;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;
use ZipArchive;

final class DocumentFileTest extends TestCase
{
    private const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

    private const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

    private const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

    public function test_empty_file_is_rejected(): void
    {
        $file = UploadedFile::fake()->createWithContent('empty.txt', '');

        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage(__('documents.invalid_file_size'));
        $this->validateFile($file);
    }

    public function test_file_larger_than_fifty_mebibytes_is_rejected_before_checking_its_type(): void
    {
        $temporary = tmpfile();
        self::assertNotFalse($temporary);

        try {
            self::assertTrue(ftruncate($temporary, 50 * 1024 * 1024 + 1));
            $path = stream_get_meta_data($temporary)['uri'];

            $this->expectException(ValidationException::class);
            $this->expectExceptionMessage(__('documents.invalid_file_size'));
            $this->validateFile(new IncomingFile($path, 'oversized.docx'));
        } finally {
            fclose($temporary);
        }
    }

    public function test_fake_office_container_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        $file = UploadedFile::fake()->createWithContent('bad.docx', 'not an office archive');
        $this->validateFile($file);
    }

    public function test_fake_image_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        $file = UploadedFile::fake()->createWithContent('bad.png', 'not an image');
        $this->validateFile($file);
    }

    public function test_main_office_part_is_resolved_from_the_package_relationship(): void
    {
        $file = $this->officeArchive([
            '[Content_Types].xml' => self::contentTypes(
                '<Default Extension="xml" ContentType="' . self::DOCX_TYPE . '"/>',
            ),
            '_rels/.rels' => '<Relationships xmlns="' . self::RELATIONSHIPS_NS . '">'
                . '<Relationship Id="rId1" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"'
                . ' Target="./parts/MaIn.xml"/>'
                . '</Relationships>',
            'parts/main.xml' => '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body/></w:document>',
        ]);

        $this->validateFile(new IncomingFile($file->getPathname(), 'report.DOCX'));
    }

    #[DataProvider('invalidOfficePackages')]
    public function test_invalid_office_package_is_rejected(array $overrides, string $error): void
    {
        $file = $this->officeArchive(array_replace([
            '[Content_Types].xml' => self::contentTypes(self::mainContentType()),
            '_rels/.rels' => '<Relationships xmlns="' . self::RELATIONSHIPS_NS . '">'
                . '<Relationship Id="rId1"'
                . ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
                . ' Target="word/document.xml"/>'
                . '</Relationships>',
            'word/document.xml' => '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                . '<w:body/></w:document>',
        ], $overrides));

        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage(__($error));
        $this->validateFile($file);
    }

    public static function invalidOfficePackages(): array
    {
        return [
            'malformed manifest' => [
                ['[Content_Types].xml' => '<Types>'],
                'documents.invalid_office_structure',
            ],
            'manifest with DTD' => [
                ['[Content_Types].xml' => '<!DOCTYPE Types>' . self::contentTypes(self::mainContentType())],
                'documents.invalid_office_structure',
            ],
            'wrong override takes precedence over correct default' => [
                [
                    '[Content_Types].xml' => self::contentTypes(
                        '<Default Extension="xml" ContentType="' . self::DOCX_TYPE . '"/>'
                        . '<Override PartName="/word/document.xml" ContentType="application/xml"/>',
                    ),
                ],
                'documents.invalid_office_format',
            ],
            'macro content type with a different part name' => [
                [
                    '[Content_Types].xml' => self::contentTypes(
                        self::mainContentType()
                        . '<Override PartName="/word/project.bin" ContentType="application/vnd.ms-office.vbaProject"/>',
                    ),
                    'word/project.bin' => 'fixture',
                ],
                'documents.unsafe_office_archive',
            ],
            'duplicate part name with different case' => [
                ['WORD/DOCUMENT.XML' => '<document/>'],
                'documents.unsafe_office_archive',
            ],
        ];
    }

    private function validateFile(IncomingFile | UploadedFile $file): void
    {
        Validator::validate(['file' => $file], ['file' => [new DocumentFile()]]);
    }

    /** @param array<string, string> $entries */
    private function officeArchive(array $entries): UploadedFile
    {
        $file = UploadedFile::fake()->createWithContent('report.docx', '');
        $zip = new ZipArchive();
        self::assertTrue($zip->open($file->getPathname(), ZipArchive::OVERWRITE));

        foreach ($entries as $name => $contents) {
            self::assertTrue($zip->addFromString($name, $contents));
        }

        self::assertTrue($zip->close());

        return $file;
    }

    private static function contentTypes(string $types): string
    {
        return '<Types xmlns="' . self::TYPES_NS . '">' . $types . '</Types>';
    }

    private static function mainContentType(): string
    {
        return '<Override PartName="/word/document.xml" ContentType="' . self::DOCX_TYPE . '"/>';
    }
}
