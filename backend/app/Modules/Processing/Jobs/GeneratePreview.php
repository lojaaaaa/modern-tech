<?php

declare(strict_types=1);

namespace App\Modules\Processing\Jobs;

use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Cache\PreviewCache;
use App\Modules\Processing\Enums\ProcessingError;
use App\Modules\Processing\Exceptions\ProcessingException;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Queue\Attributes\DeleteWhenMissingModels;
use Illuminate\Queue\Attributes\WithoutRelations;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Throwable;

#[DeleteWhenMissingModels]
final class GeneratePreview implements ShouldQueue
{
    use Queueable {
        __unserialize as private restoreQueueable;
    }

    private const MAX_PDF_BYTES = 100 * 1024 * 1024;

    public int $tries = 2;

    public int $timeout = 220;

    #[WithoutRelations]
    private ?DocumentVersion $version = null;

    public function __construct(DocumentVersion $version)
    {
        $this->version = $version;
        $this->onQueue('processing');
    }

    /** @param array<string, mixed> $values */
    public function __unserialize(array $values): void
    {
        $this->restoreQueueable($values);

        // Jobs produced before model serialization contain only the version ID.
        if ($this->version === null && is_string($values['versionId'] ?? null)) {
            $this->version = DocumentVersion::query()->find($values['versionId']);
        }
    }

    public function handle(PreviewCache $cache): void
    {
        $version = $this->version;
        if ($version === null) {
            return;
        }

        $cache->generate($version->id, fn () => $this->generate($version, $cache));
    }

    private function generate(DocumentVersion $version, PreviewCache $cache): void
    {
        $stream = null;
        $pdf = null;

        try {
            if (! $version->canGeneratePreview()) {
                return;
            }

            $disk = Storage::disk('local');
            $stream = $disk->readStream($version->storage_key);
            if (! is_resource($stream)) {
                throw new ProcessingException(ProcessingError::ORIGINAL_UNAVAILABLE);
            }

            $pdf = tmpfile();
            if ($pdf === false) {
                throw new ProcessingException(ProcessingError::PREVIEW_UNAVAILABLE);
            }

            $response = Http::connectTimeout(10)
                ->timeout(190)
                ->withoutRedirecting()
                ->sink($pdf)
                ->withOptions(['progress' => static function (int $total, int $downloaded): void {
                    if (max($total, $downloaded) > self::MAX_PDF_BYTES) {
                        throw new ProcessingException(ProcessingError::PREVIEW_TOO_LARGE);
                    }
                }])
                ->attach('files', $stream, 'document.' . $version->getFileExtension())
                ->post(config('processing.gotenberg_url') . '/forms/libreoffice/convert', ['nativePageRanges' => '1-200']);

            if (! $response->successful() || ! rewind($pdf) || fread($pdf, 5) !== '%PDF-') {
                throw new ProcessingException(ProcessingError::PREVIEW_CONVERSION_FAILED);
            }

            $key = 'previews/' . $version->id . '.pdf';
            if (! rewind($pdf) || ! $disk->put($key, $pdf)) {
                throw new ProcessingException(ProcessingError::PREVIEW_WRITE_FAILED);
            }

            $version->update(['preview_key' => $key]);
            $cache->clear($version->id);
        } catch (Throwable $error) {
            $cache->record($version->id);

            throw match (true) {
                $error instanceof ProcessingException => $error,
                $error instanceof ConnectionException => new ProcessingException(ProcessingError::PREVIEW_CONVERSION_FAILED, $error),
                default => new ProcessingException(ProcessingError::PREVIEW_FAILED, $error),
            };
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
            if (is_resource($pdf)) {
                fclose($pdf);
            }
        }
    }
}
