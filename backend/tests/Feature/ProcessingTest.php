<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Cache\VersionProcessingLock;
use App\Modules\Processing\Exceptions\ProcessingException;
use App\Modules\Processing\Jobs\ProcessVersion;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProcessingTest extends TestCase
{
    use RefreshDatabase;

    public function test_late_old_version_cannot_replace_new_desired_version(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('original.txt', 'text');
        $user = User::factory()->create();
        $doc = Document::query()->create(['owner_id' => $user->id, 'title' => 'Versioned']);
        $attrs = ['document_id' => $doc->id, 'creator_id' => $user->id, 'storage_key' => 'original.txt', 'original_name' => 'original.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text')];
        $old = DocumentVersion::query()->create($attrs + ['number' => 1]);
        $new = DocumentVersion::query()->create($attrs + ['number' => 2]);
        $doc->update(['desired_version_id' => $new->id]);
        $this->mock(VirusScanner::class)->shouldReceive('assertClean')->twice();
        $this->mock(TextExtractor::class)->shouldReceive('extract')->twice()->andReturn('text');

        ProcessVersion::dispatchSync($new->id);
        ProcessVersion::dispatchSync($old->id);
        $this->assertSame($new->id, $doc->refresh()->published_version_id);
        ProcessVersion::dispatchSync($new->id);
        $this->assertDatabaseCount('document_versions', 2);
        $this->assertSame(1, $new->refresh()->processing_attempts);
    }

    public function test_publication_batches_entities_and_preserves_overlapping_unicode_segments(): void
    {
        $version = $this->queuedVersion();
        $text = str_repeat("😀 ООО «Архив» 30.10.2026 10 RUB hello@example.org\n", 1001);
        $this->mock(VirusScanner::class)->shouldReceive('assertClean')->once();
        $this->mock(TextExtractor::class)->shouldReceive('extract')->once()->andReturn($text);
        $writes = ['document_entities' => 0, 'text_segments' => 0];
        DB::listen(static function (QueryExecuted $query) use (&$writes): void {
            foreach (array_keys($writes) as $table) {
                if (str_starts_with($query->sql, 'insert into "' . $table . '"')) {
                    $writes[$table]++;
                }
            }
        });

        ProcessVersion::dispatchSync($version->id);

        $this->assertDatabaseCount('document_entities', 4000);
        $this->assertGreaterThan(0, $writes['document_entities']);
        $this->assertLessThanOrEqual(40, $writes['document_entities']);
        $this->assertSame(1, $writes['text_segments']);
        $expected = [];
        for ($offset = 0; $offset < mb_strlen($text); $offset += 11800) {
            $expected[] = mb_substr($text, $offset, 12000);
        }
        $segments = DB::table('text_segments')->where('version_id', $version->id)->orderBy('ordinal')->pluck('content');
        $this->assertSame($expected, $segments->all());
    }

    public function test_oversized_extraction_is_terminal_even_after_redelivery(): void
    {
        $version = $this->queuedVersion();
        $this->mock(VirusScanner::class)->shouldReceive('assertClean')->once();
        Http::fake(['*' => Http::response(str_repeat('x', 8 * 1024 * 1024 + 1))]);

        ProcessVersion::dispatchSync($version->id);
        ProcessVersion::dispatchSync($version->id);

        $this->assertSame('failed', $version->refresh()->status);
        $this->assertSame('EXTRACTED_TEXT_TOO_LARGE', $version->error_code);
        $this->assertSame(1, $version->processing_attempts);
        $this->assertNull($version->document->published_version_id);
    }

    public function test_infected_file_is_rejected_before_extraction(): void
    {
        $version = $this->queuedVersion();
        Process::fake(fn () => Process::result(exitCode: 1));
        $this->mock(TextExtractor::class)->shouldNotReceive('extract');

        ProcessVersion::dispatchSync($version->id);
        ProcessVersion::dispatchSync($version->id);

        $this->assertSame('rejected', $version->refresh()->status);
        $this->assertSame('FILE_INFECTED', $version->error_code);
        $this->assertSame(1, $version->processing_attempts);
    }

    public function test_scanner_error_can_retry_and_publish(): void
    {
        $version = $this->queuedVersion();
        $path = realpath(Storage::disk('local')->path($version->storage_key));
        Process::fake(['*' => Process::sequence()
            ->push(Process::result(exitCode: 2))
            ->push(Process::result($path . ': OK'))]);
        Http::fake(['*' => Http::response('Текст документа')]);

        $this->assertThrows(fn () => ProcessVersion::dispatchSync($version->id), ProcessingException::class, 'SCAN_FAILED');
        $this->assertNull($version->document->published_version_id);
        $this->assertSame('failed', $version->refresh()->status);

        ProcessVersion::dispatchSync($version->id);

        $this->assertSame('ready', $version->refresh()->status);
        $this->assertNull($version->error_code);
        $this->assertSame(2, $version->processing_attempts);
        $this->assertSame($version->id, $version->document->published_version_id);
    }

    public function test_failed_version_without_an_error_code_can_retry(): void
    {
        $version = $this->queuedVersion();
        $version->update(['status' => 'failed', 'processing_attempts' => 1]);

        $this->mock(VirusScanner::class)->shouldReceive('assertClean')->once();
        $this->mock(TextExtractor::class)->shouldReceive('extract')->once()->andReturn('text');

        ProcessVersion::dispatchSync($version->id);

        $this->assertSame('ready', $version->refresh()->status);
        $this->assertSame(2, $version->processing_attempts);
    }

    public function test_lock_contention_does_not_start_a_processing_attempt(): void
    {
        $version = $this->queuedVersion();
        $job = (new ProcessVersion($version->id))->withFakeQueueInteractions();
        app(VersionProcessingLock::class)->tryRun($version->id, fn () => app()->call([$job, 'handle']));

        $job->assertReleased(30);
        $this->assertSame(0, $version->refresh()->processing_attempts);
    }

    private function queuedVersion(): DocumentVersion
    {
        Storage::fake('local')->put('original.txt', 'text');
        $user = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $user->id, 'title' => 'Versioned']);
        $version = $document->versions()->create([
            'number' => 1, 'creator_id' => $user->id, 'storage_key' => 'original.txt', 'original_name' => 'original.txt',
            'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text'),
        ]);
        $document->update(['desired_version_id' => $version->id]);

        return $version;
    }
}
