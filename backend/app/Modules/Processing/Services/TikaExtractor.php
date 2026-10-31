<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

use GuzzleHttp\Psr7\Utils;
use Illuminate\Support\Facades\Http;
use RuntimeException;

final class TikaExtractor implements TextExtractor
{
    public function extract(string $path, string $mime): string
    {
        $stream = fopen($path, 'rb');
        if (! $stream) {
            throw new RuntimeException('ORIGINAL_UNAVAILABLE');
        }
        try {
            $response = Http::connectTimeout(10)->timeout(850)->withOptions(['allow_redirects' => false, 'stream' => true])->withHeaders(['Accept' => 'text/plain', 'X-Tika-OCRLanguage' => 'rus+eng'])->withBody(Utils::streamFor($stream), $mime)->put(config('processing.tika_url').'/tika');
            if (! $response->successful()) {
                throw new RuntimeException('EXTRACTION_FAILED');
            }
            $body = $response->toPsrResponse()->getBody();
            $text = '';
            try {
                while (! $body->eof()) {
                    $text .= $body->read(65536);
                    if (strlen($text) > 8 * 1024 * 1024) {
                        throw new RuntimeException('EXTRACTED_TEXT_TOO_LARGE');
                    }
                }
            } finally {
                $body->close();
            }

            return mb_convert_encoding($text, 'UTF-8', 'UTF-8');
        } finally {
            fclose($stream);
        }
    }
}
