<?php

declare(strict_types=1);

namespace App\Modules\Documents\Rules;

use GuzzleHttp\Psr7\UriResolver;
use SimpleXMLElement;
use ZipArchive;

final class OfficePackage
{
    private const MAX_ENTRIES = 10_000;
    private const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
    private const MAX_METADATA_BYTES = 2 * 1024 * 1024;

    private const MAIN_TYPES = [
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    ];
    private const MACRO_TYPES = [
        'application/vnd.ms-office.vbaproject',
        'application/vnd.ms-excel.macrosheet+xml',
        'application/vnd.ms-excel.intlmacrosheet+xml',
    ];
    private const OFFICE_RELATIONSHIPS = [
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
        'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
    ];

    /** @param 'docx'|'xlsx'|'pptx' $extension */
    public function validationError(string $path, string $extension): ?string
    {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::RDONLY | ZipArchive::CHECKCONS) !== true) {
            return 'documents.invalid_office_archive';
        }

        try {
            return $this->inspect($zip, self::MAIN_TYPES[$extension]);
        } finally {
            $zip->close();
        }
    }

    private function inspect(ZipArchive $zip, string $expectedType): ?string
    {
        if ($zip->numFiles > self::MAX_ENTRIES) {
            return 'documents.invalid_office_structure';
        }

        $sizes = [];
        $total = 0;
        for ($index = 0; $index < $zip->numFiles; $index++) {
            $entry = $zip->statIndex($index);
            if ($entry === false) {
                return 'documents.unreadable_office_structure';
            }

            $name = $this->partName('/' . $entry['name']);
            $total += $entry['size'];
            if ($total > self::MAX_EXPANDED_BYTES || isset($sizes[$name]) || ! $this->isAllowedEntry($entry)) {
                return 'documents.unsafe_office_archive';
            }
            $sizes[$name] = $entry['size'];
        }

        $links = $this->metadata($zip, '_rels/.rels', 'Relationships', 'relationships');
        if ($links === null) {
            return 'documents.invalid_office_structure';
        }
        $main = $this->mainPart($links);
        if ($main === null || ($sizes[$main] ?? 0) === 0) {
            return 'documents.invalid_office_format';
        }

        $types = $this->metadata($zip, '[Content_Types].xml', 'Types', 'content-types');

        return $types === null ? 'documents.invalid_office_structure' : $this->checkType($types, $main, $expectedType);
    }

    /** @param array{name: string, size: int, comp_method: int, encryption_method?: int} $entry */
    private function isAllowedEntry(array $entry): bool
    {
        if (
            $entry['size'] < 0 || ($entry['encryption_method'] ?? null) !== ZipArchive::EM_NONE
            || ! in_array($entry['comp_method'], [ZipArchive::CM_STORE, ZipArchive::CM_DEFLATE], true)
        ) {
            return false;
        }

        $path = strtolower(rawurldecode($entry['name']));

        return $path !== '' && ! str_starts_with($path, '/') && ! str_contains($path, '//')
            && ! str_contains($path, '\\') && basename($path) !== 'vbaproject.bin'
            && ! preg_match('~^[a-z]:|(?:^|/)\.{1,2}(?:/|$)|[\x00-\x1f\x7f]~', $path)
            && ! preg_match('~%(?:2f|5c)~i', $entry['name']);
    }

    private function metadata(ZipArchive $zip, string $file, string $root, string $namespace): ?SimpleXMLElement
    {
        $entry = $zip->statName($file, ZipArchive::FL_NOCASE);
        if ($entry === false || $entry['size'] < 1 || $entry['size'] > self::MAX_METADATA_BYTES) {
            return null;
        }

        $xml = @$zip->getFromIndex($entry['index'], self::MAX_METADATA_BYTES);
        if ($xml === false || strlen($xml) !== $entry['size'] || crc32($xml) !== $entry['crc']) {
            return null;
        }

        $document = simplexml_load_string($xml, options: LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        if ($document === false || $document->getName() !== $root) {
            return null;
        }

        $element = dom_import_simplexml($document);
        $uri = 'http://schemas.openxmlformats.org/package/2006/' . $namespace;

        return $element->namespaceURI === $uri && $element->ownerDocument->doctype === null
            ? $document->children($uri) : null;
    }

    private function mainPart(SimpleXMLElement $relationships): ?string
    {
        $main = null;
        foreach ($relationships->Relationship as $link) {
            $attributes = $link->attributes();
            if (! in_array((string) $attributes['Type'], self::OFFICE_RELATIONSHIPS, true)) {
                continue;
            }
            $target = (string) $attributes['Target'];
            if ($main !== null || ! in_array((string) $attributes['TargetMode'], ['', 'Internal'], true)
                || parse_url($target, PHP_URL_PATH) !== $target) {
                return null;
            }
            $main = $this->partName(UriResolver::removeDotSegments('/' . ltrim($target, '/')));
        }

        return $main;
    }

    private function checkType(SimpleXMLElement $types, string $main, string $expected): ?string
    {
        $extension = pathinfo($main, PATHINFO_EXTENSION);
        $matches = [];
        foreach ($types as $node) {
            $attributes = $node->attributes();
            $type = strtolower(trim(explode(';', (string) $attributes['ContentType'], 2)[0]));
            if (in_array($type, self::MACRO_TYPES, true)) {
                return 'documents.unsafe_office_archive';
            }

            $kind = $node->getName();
            $isApplicable = match ($kind) {
                'Override' => $this->partName((string) $attributes['PartName']) === $main,
                'Default' => strtolower((string) $attributes['Extension']) === $extension,
                default => false,
            };
            if ($isApplicable) {
                if (isset($matches[$kind])) {
                    return 'documents.invalid_office_structure';
                }
                $matches[$kind] = $type;
            }
        }

        $actual = $matches['Override'] ?? $matches['Default'] ?? null;

        return $actual === $expected ? null : 'documents.invalid_office_format';
    }

    private function partName(string $path): string
    {
        // ZIP stores non-ASCII part names percent-encoded; the XML can use their Unicode spelling.
        $encoded = preg_replace_callback('/[\x80-\xff]+/', static fn (array $match) => rawurlencode($match[0]), $path);

        return strtolower($encoded ?? $path);
    }
}
