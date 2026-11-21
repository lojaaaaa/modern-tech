<?php

declare(strict_types=1);

namespace App\Modules\Processing;

use App\Modules\Documents\Enums\DocumentVersionStatus;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Cache\VersionProcessingLock;
use App\Modules\Processing\Enums\ProcessingError;
use App\Modules\Processing\Exceptions\ProcessingException;
use App\Modules\Processing\Services\EntityExtractor;
use App\Modules\Processing\Services\SearchIndexer;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Carbon\CarbonInterface;
use Generator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class VersionProcessing
{
    private const MAX_ATTEMPTS = 5;

    private const TERMINAL_STATUSES = [
        DocumentVersionStatus::READY->value,
        DocumentVersionStatus::REJECTED->value,
        DocumentVersionStatus::CANCELLED->value,
    ];

    public function __construct(
        private readonly VersionProcessingLock $lock,
        private readonly VirusScanner $scanner,
        private readonly TextExtractor $extractor,
        private readonly EntityExtractor $entities,
        private readonly SearchIndexer $indexer,
    ) {
    }

    /** Returns false when another worker or the recovery command holds the version lock. */
    public function tryProcess(string $versionId): bool
    {
        return $this->lock->tryRun($versionId, fn () => $this->process($versionId)) !== false;
    }

    /** @return Generator<int, string> Version IDs ready to requeue after releasing the lock. */
    public function recoverInterrupted(): Generator
    {
        $cutoff = now()->subMinutes(20);
        $versionIds = $this->getInterruptedVersions($cutoff)->limit(100)->pluck('id');

        foreach ($versionIds as $versionId) {
            $isRequeueNeeded = $this->lock->tryRun($versionId, fn (): bool => $this->recoverVersion($versionId, $cutoff));
            if ($isRequeueNeeded === true) {
                yield $versionId;
            }
        }
    }

    /** @return Builder<DocumentVersion> */
    private function getInterruptedVersions(CarbonInterface $cutoff): Builder
    {
        return DocumentVersion::query()->whereHas('document')
            ->whereIn('status', [
                DocumentVersionStatus::QUARANTINED->value,
                DocumentVersionStatus::SCANNING->value,
                DocumentVersionStatus::EXTRACTING->value,
            ])
            ->where('updated_at', '<', $cutoff);
    }

    private function recoverVersion(string $versionId, CarbonInterface $cutoff): bool
    {
        $interrupted = $this->getInterruptedVersions($cutoff)->whereKey($versionId);
        $requeued = (clone $interrupted)->where('processing_attempts', '<', self::MAX_ATTEMPTS)
            ->update(['status' => DocumentVersionStatus::QUARANTINED->value]);

        if ($requeued === 1) {
            return true;
        }

        $interrupted->where('processing_attempts', '>=', self::MAX_ATTEMPTS)
            ->update([
                'status' => DocumentVersionStatus::FAILED->value,
                'error_code' => 'ATTEMPTS_EXHAUSTED',
            ]);

        return false;
    }

    private function process(string $versionId): void
    {
        $version = DocumentVersion::query()->whereHas('document')->find($versionId);
        if (
            ! $version
            || in_array($version->status, self::TERMINAL_STATUSES, true)
            || ($version->status === DocumentVersionStatus::FAILED->value
                && $version->error_code !== null
                && ProcessingError::tryFrom($version->error_code)?->isRetryable() === false)
            || $version->processing_attempts >= self::MAX_ATTEMPTS
        ) {
            return;
        }

        $path = Storage::disk('local')->path($version->storage_key);
        $previousAttempts = (int) $version->processing_attempts;
        $claimed = $this->forAttempt($versionId, $previousAttempts)
            ->where('status', $version->status)
            ->increment('processing_attempts', 1, [
                'status' => DocumentVersionStatus::SCANNING->value,
                'error_code' => null,
                'processing_started_at' => now(),
            ]);
        if ($claimed !== 1) {
            return;
        }

        $attempt = $previousAttempts + 1;
        try {
            $this->scanner->assertClean($path);
            $updated = $this->forAttempt($versionId, $attempt)
                ->where('status', DocumentVersionStatus::SCANNING->value)
                ->update(['status' => DocumentVersionStatus::EXTRACTING->value]);
            if ($updated !== 1) {
                return;
            }

            $text = $this->extractor->extract($path, $version->mime);
            $this->storeResult($version, $attempt, $text);
        } catch (Throwable $error) {
            $reason = $error instanceof ProcessingException ? $error->reason : ProcessingError::PROCESSING_FAILED;
            $status = $reason === ProcessingError::FILE_INFECTED ? DocumentVersionStatus::REJECTED : DocumentVersionStatus::FAILED;
            $this->forAttempt($versionId, $attempt)
                ->whereIn('status', [
                    DocumentVersionStatus::SCANNING->value,
                    DocumentVersionStatus::EXTRACTING->value,
                ])
                ->update(['status' => $status->value, 'error_code' => $reason->value]);

            if ($reason->isRetryable()) {
                throw $error;
            }
        }
    }

    /** @return Builder<DocumentVersion> */
    private function forAttempt(string $versionId, int $attempt): Builder
    {
        return DocumentVersion::query()->whereKey($versionId)->where('processing_attempts', $attempt);
    }

    private function storeResult(DocumentVersion $version, int $attempt, string $text): void
    {
        $entities = $this->entities->extract($text);
        $segments = $this->indexer->segments($text);

        DB::transaction(function () use ($version, $attempt, $text, $entities, $segments): void {
            $document = $version->document()->lockForUpdate()->first();
            if (! $document) {
                return;
            }

            $currentVersion = $this->forAttempt($version->id, $attempt)
                ->where('status', DocumentVersionStatus::EXTRACTING->value)
                ->lockForUpdate()->first();
            if (! $currentVersion) {
                return;
            }

            $this->entities->replace($currentVersion->id, $entities);
            $this->indexer->replace($currentVersion->id, $segments);
            $currentVersion->update([
                'extracted_text' => $text,
                'status' => DocumentVersionStatus::READY->value,
                'error_code' => null,
            ]);
            if ($document->desired_version_id === $currentVersion->id) {
                $document->update(['published_version_id' => $currentVersion->id]);
            }
        });
    }
}
