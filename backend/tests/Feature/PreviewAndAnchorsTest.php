<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Cache\PreviewCache;
use App\Modules\Processing\Enums\ProcessingError;
use App\Modules\Processing\Exceptions\ProcessingException;
use App\Modules\Processing\Jobs\GeneratePreview;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use ReflectionClass;
use Tests\TestCase;

class PreviewAndAnchorsTest extends TestCase
{
    use RefreshDatabase;

    private function document(string $name = 'image.png', string $mime = 'image/png'): array
    {
        Storage::fake('local');
        $owner = User::factory()->create();
        $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => $name]);
        Storage::disk('local')->put('original', 'test');
        $version = DocumentVersion::query()->create(['document_id' => $doc->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'original', 'original_name' => $name, 'mime' => $mime, 'size' => 4, 'sha256' => hash('sha256', 'test'), 'status' => 'ready', 'extracted_text' => "Начало 😀\nВажный фрагмент\nКонец"]);

        $doc->update(['published_version_id' => $version->id, 'desired_version_id' => $version->id]);

        return [$owner, $doc, $version];
    }

    public function test_preview_requires_read_and_clean_version(): void
    {
        [$owner, $doc, $v] = $this->document();
        $stranger = User::factory()->create();
        $url = '/api/v1/versions/'.$v->id.'/preview';
        $this->actingAs($stranger)->getJson($url)->assertNotFound();
        $doc->grants()->create(['user_id' => $stranger->id, 'read' => true]);
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png')->assertHeader('Cache-Control', 'no-store, private');
        $this->getJson('/api/v1/versions/'.$v->id.'/download')->assertForbidden();
        $v->update(['status' => 'scanning']);
        $this->getJson($url)->assertConflict();
    }

    public function test_office_preview_is_queued_once_and_does_not_return_original(): void
    {
        Queue::fake()->serializeAndRestore();
        [$owner, $doc, $v] = $this->document('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        $url = '/api/v1/versions/'.$v->id.'/preview';
        $this->actingAs($owner)->getJson($url . '?status=invalid')
            ->assertUnprocessable()
            ->assertJsonStructure(['error' => ['details' => ['status']]]);
        Queue::assertNothingPushed();

        $this->actingAs($owner)->getJson($url.'?status=1')->assertOk()->assertJsonPath('data.status', 'pending');
        $this->getJson($url . '?status=true')->assertOk()->assertJsonPath('data.kind', 'pdf');
        Queue::assertPushed(GeneratePreview::class, 1);
        $this->getJson($url)->assertNotFound();
    }

    public function test_office_preview_can_retry_after_a_failed_write(): void
    {
        [, , $version] = $this->document('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        $key = 'previews/' . $version->id . '.pdf';
        $cache = app(PreviewCache::class);
        $pdf = "%PDF-1.7\npreview";
        $url = config('processing.gotenberg_url') . '/forms/libreoffice/convert';
        Http::preventStrayRequests()->fake([$url => fn () => Http::response($pdf)]);

        $disk = Storage::disk('local');
        $disk->makeDirectory($key);
        $job = (new ReflectionClass(GeneratePreview::class))->newInstanceWithoutConstructor();
        $job->__unserialize(['versionId' => $version->id]);

        $this->assertThrows(
            fn () => app()->call([$job, 'handle']),
            fn (ProcessingException $error) => $error->reason === ProcessingError::PREVIEW_WRITE_FAILED,
        );
        $this->assertNull($version->fresh()->preview_key);
        $this->assertTrue($cache->hasError($version->id));

        $disk->deleteDirectory($key);
        GeneratePreview::dispatchSync($version);

        $this->assertSame($key, $version->fresh()->preview_key);
        $this->assertSame($pdf, $disk->get($key));
        $this->assertFalse($cache->hasError($version->id));
        Http::assertSent(fn (Request $request) => $request->hasFile('files', filename: 'document.docx')
            && (collect($request->data())->firstWhere('name', 'nativePageRanges')['contents'] ?? null) === '1-200');
    }

    public function test_queued_preview_is_discarded_when_the_version_is_deleted(): void
    {
        [, , $version] = $this->document('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        Http::preventStrayRequests();
        $queue = Queue::connection('database');
        $queue->push(new GeneratePreview($version), queue: 'processing');
        $version->delete();

        $job = $queue->pop('processing');
        $this->assertNotNull($job);
        $job->fire();

        $this->assertTrue($job->isDeleted());
        $this->assertFalse($job->hasFailed());
    }

    public function test_preview_conversion_error_keeps_the_connection_failure_as_its_cause(): void
    {
        [$owner, , $version] = $this->document('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        $url = config('processing.gotenberg_url') . '/forms/libreoffice/convert';
        Http::preventStrayRequests()->fake([$url => Http::failedConnection('Gotenberg unavailable')]);

        $this->assertThrows(
            fn () => GeneratePreview::dispatchSync($version),
            fn (ProcessingException $error) => $error->reason === ProcessingError::PREVIEW_CONVERSION_FAILED
                && $error->getPrevious() instanceof ConnectionException,
        );
        $this->actingAs($owner)->getJson('/api/v1/versions/' . $version->id . '/preview?status=1')
            ->assertOk()->assertJsonPath('data.status', 'failed');
    }

    public function test_anchor_is_version_bound_and_uses_browser_utf16_offsets(): void
    {
        [$owner, $doc, $v] = $this->document();
        $payload = ['body' => 'Проверьте этот фрагмент', 'version_id' => $v->id, 'anchor_start' => 10, 'anchor_end' => 25, 'anchor_quote' => 'Важный фрагмент'];
        // UTF-16: "Начало " = 7, emoji = 2, newline = 1; quote length = 15.
        $this->actingAs($owner)->postJson('/api/v1/documents/'.$doc->id.'/comments', $payload)->assertCreated()->assertJsonPath('data.anchor_start', 10)->assertJsonPath('data.anchor_quote', 'Важный фрагмент');
        $whitespace = $payload;
        $whitespace['anchor_start'] = 9;
        $whitespace['anchor_quote'] = "\nВажный фрагмент";
        $this->postJson('/api/v1/documents/'.$doc->id.'/comments', $whitespace)->assertCreated();
        $payload['anchor_quote'] = 'Подменённый текст';
        $this->postJson('/api/v1/documents/'.$doc->id.'/comments', $payload)->assertUnprocessable();
        $payload['anchor_end'] = 99999;
        $this->postJson('/api/v1/documents/'.$doc->id.'/comments', $payload)->assertUnprocessable();
        $payload['version_id'] = (string) Str::uuid();
        $this->postJson('/api/v1/documents/'.$doc->id.'/comments', $payload)->assertUnprocessable();
    }
}
