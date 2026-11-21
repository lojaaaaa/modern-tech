<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Enums\DocumentVersionStatus;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Jobs\ProcessVersion;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class ReconciliationTest extends TestCase
{
    use RefreshDatabase;

    public function test_stale_local_processing_is_requeued_but_attempt_limit_is_terminal(): void
    {
        Queue::fake();
        $retry = $this->interruptedVersion();
        $exhausted = $this->interruptedVersion(attempts: 5);

        $this->artisan('processing:reconcile')->assertSuccessful();

        Queue::assertPushed(ProcessVersion::class, fn ($job) => $job->versionId === $retry->id);
        Queue::assertPushed(ProcessVersion::class, 1);
        $this->assertSame(DocumentVersionStatus::FAILED->value, $exhausted->refresh()->status);
        $this->assertSame('ATTEMPTS_EXHAUSTED', $exhausted->error_code);
    }

    #[DataProvider('changesBeforeLockAcquisition')]
    public function test_recovery_preserves_a_version_that_is_no_longer_eligible(
        DocumentVersionStatus $status,
        bool $isActivityRecent,
    ): void {
        Queue::fake();
        $version = $this->interruptedVersion();
        $store = Cache::store('array');

        Cache::shouldReceive('lock')->once()->with('process-version:' . $version->id, 960)
            ->andReturnUsing(function (string $key, int $seconds) use ($version, $status, $isActivityRecent, $store) {
                // Simulate a change committed after the command selected this version.
                DocumentVersion::query()->whereKey($version->id)->update([
                    'status' => $status->value,
                    'updated_at' => $isActivityRecent ? now() : $version->updated_at,
                ]);

                return $store->lock($key, $seconds);
            });

        $this->artisan('processing:reconcile')->assertSuccessful();

        $this->assertSame($status->value, $version->refresh()->status);
        Queue::assertNothingPushed();
    }

    /** @return array<string, array{DocumentVersionStatus, bool}> */
    public static function changesBeforeLockAcquisition(): array
    {
        return [
            'completed' => [DocumentVersionStatus::READY, false],
            'cancelled' => [DocumentVersionStatus::CANCELLED, false],
            'resumed extraction' => [DocumentVersionStatus::EXTRACTING, true],
        ];
    }

    public function test_recovery_dispatches_after_releasing_the_version_lock(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('test.txt', 'test');
        $version = $this->interruptedVersion();
        $this->mock(VirusScanner::class)->shouldReceive('assertClean')->once();
        $this->mock(TextExtractor::class)->shouldReceive('extract')->once()->andReturn('test');

        $this->artisan('processing:reconcile')->assertSuccessful();

        $this->assertSame(DocumentVersionStatus::READY->value, $version->refresh()->status);
        $this->assertSame(2, $version->processing_attempts);
    }

    private function interruptedVersion(int $attempts = 1): DocumentVersion
    {
        $user = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $user->id, 'title' => 'test']);

        return $document->versions()->create([
            'creator_id' => $user->id,
            'number' => 1,
            'storage_key' => 'test.txt',
            'original_name' => 'test.txt',
            'mime' => 'text/plain',
            'size' => 4,
            'sha256' => hash('sha256', 'test'),
            'status' => DocumentVersionStatus::EXTRACTING->value,
            'updated_at' => now()->subHour(),
            'processing_attempts' => $attempts,
        ]);
    }
}
