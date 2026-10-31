<?php

declare(strict_types=1);

namespace App\Modules\Processing\Jobs;

use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Services\EntityExtractor;
use App\Modules\Processing\Services\SearchIndexer;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class ProcessVersion implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 900;

    public function __construct(public string $versionId)
    {
        $this->onQueue('processing');
    }

    public function backoff(): array
    {
        return [10, 60, 300];
    }

    public function handle(VirusScanner $scanner, TextExtractor $extractor): void
    {
        $lock = Cache::lock('process-version:'.$this->versionId, 960);
        if (! $lock->get()) {
            $this->release(30);

            return;
        }
        try {
            $version = DocumentVersion::find($this->versionId);
            if (! $version || ! $version->document || in_array($version->status, ['ready', 'rejected', 'cancelled'], true)) {
                return;
            }
            $path = Storage::disk('local')->path($version->storage_key);
            if ($version->processing_attempts >= 5) {
                return;
            }
            $version->increment('processing_attempts');
            $version->update(['status' => 'scanning', 'error_code' => null, 'processing_started_at' => now()]);
            $scanner->assertClean($path);
            $version->update(['status' => 'extracting']);
            $text = $extractor->extract($path, $version->mime);
            DB::transaction(function () use ($version, $text): void {
                $document = Document::whereKey($version->document_id)->lockForUpdate()->first();
                if (! $document) {
                    return;
                }
                $version->refresh();
                if ($version->status === 'cancelled') {
                    return;
                }
                app(EntityExtractor::class)->replace($version->id, $text);
                app(SearchIndexer::class)->replace($version->id, $text);
                $version->update(['extracted_text' => $text, 'status' => 'ready', 'error_code' => null]);
                if ($document->desired_version_id === $version->id) {
                    $document->update(['published_version_id' => $version->id]);
                }
            });
        } catch (Throwable $error) {
            $safeCodes = ['FILE_INFECTED', 'SCAN_FAILED', 'SCANNER_UNAVAILABLE', 'ORIGINAL_UNAVAILABLE', 'EXTRACTION_FAILED', 'EXTRACTED_TEXT_TOO_LARGE'];
            $code = in_array($error->getMessage(), $safeCodes, true) ? $error->getMessage() : 'PROCESSING_FAILED';
            DocumentVersion::whereKey($this->versionId)->update(['status' => $code === 'FILE_INFECTED' ? 'rejected' : 'failed', 'error_code' => $code]);
            if ($code !== 'FILE_INFECTED') {
                throw $error;
            }
        } finally {
            $lock->release();
        }
    }
}
