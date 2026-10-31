<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Jobs\GeneratePreview;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class PreviewAndAnchorsTest extends TestCase
{
    use RefreshDatabase;

    private function document(string $name = 'image.png', string $mime = 'image/png'): array
    {
        Storage::fake('local');
        $owner = User::factory()->create();
        $doc = Document::create(['owner_id' => $owner->id, 'title' => $name]);
        Storage::disk('local')->put('original', 'test');
        $version = DocumentVersion::create(['document_id' => $doc->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'original', 'original_name' => $name, 'mime' => $mime, 'size' => 4, 'sha256' => hash('sha256', 'test'), 'status' => 'ready', 'extracted_text' => "Начало 😀\nВажный фрагмент\nКонец"]);

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
        Queue::fake();
        [$owner, $doc, $v] = $this->document('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        $url = '/api/v1/versions/'.$v->id.'/preview';
        $this->actingAs($owner)->getJson($url.'?status=1')->assertOk()->assertJsonPath('data.status', 'pending');
        $this->getJson($url.'?status=1')->assertOk();
        Queue::assertPushed(GeneratePreview::class, 1);
        $this->getJson($url)->assertNotFound();
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
