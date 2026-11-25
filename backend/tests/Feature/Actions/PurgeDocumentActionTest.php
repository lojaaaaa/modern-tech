<?php

declare(strict_types=1);

namespace Tests\Feature\Actions;

use App\Models\User;
use App\Modules\Documents\Jobs\RemoveDocumentFiles;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PurgeDocumentActionTest extends TestCase
{
    use RefreshDatabase;

    public function test_purge_requires_trash_and_manage_permission_and_preserves_shared_files(): void
    {
        Storage::fake('local');
        $owner = User::factory()->create();
        $reader = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Акт приёмки']);
        $version = $this->createVersion($document, 'shared.txt', 'preview.pdf');
        $other = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Копия']);
        $this->createVersion($other, 'shared.txt', null);
        Storage::disk('local')->put('shared.txt', 'version file');
        Storage::disk('local')->put('preview.pdf', 'preview file');
        DB::table('text_segments')->insert(['version_id' => $version->id, 'ordinal' => 0, 'content' => 'Пример']);
        $commentId = (string) Str::uuid();
        foreach ([[$commentId, null], [(string) Str::uuid(), $commentId]] as [$id, $parent]) {
            DB::table('document_comments')->insert([
                'id' => $id, 'document_id' => $document->id, 'version_id' => $version->id,
                'parent_id' => $parent, 'author_id' => $owner->id, 'body' => 'Комментарий',
            ]);
        }
        $document->grants()->create(['user_id' => $reader->id, 'read' => true]);

        $url = '/api/v1/documents/' . $document->id . '/purge';
        $this->actingAs($owner)->deleteJson($url)->assertNotFound();
        $document->delete();
        $this->actingAs($reader)->deleteJson($url)->assertForbidden();
        $this->actingAs($owner)->deleteJson($url)->assertOk();
        $this->deleteJson($url)->assertNotFound();

        $this->assertModelMissing($document);
        $this->assertModelMissing($version);
        $this->assertDatabaseCount('text_segments', 0);
        $this->assertDatabaseCount('document_comments', 0);
        $this->assertDatabaseCount('document_grants', 0);
        $this->assertDatabaseHas('audit_events', ['action' => 'document.purged', 'resource_id' => $document->id]);
        $this->assertDatabaseCount('audit_events', 1);

        $event = DB::table('outbox_events')->where('type', 'storage.remove_document_files')->first();
        $cleanup = new RemoveDocumentFiles(json_decode($event->payload, true, flags: JSON_THROW_ON_ERROR)['keys']);
        $cleanup->handle();
        $cleanup->handle();
        Storage::disk('local')->assertExists('shared.txt');
        Storage::disk('local')->assertMissing('preview.pdf');
    }

    public function test_active_or_unreachable_editor_preserves_document_and_closed_editor_allows_purge(): void
    {
        config(['office.internal_url' => 'http://office.test', 'office.jwt_secret' => str_repeat('s', 32)]);
        Http::fake(['http://office.test/*' => Http::sequence()->push(['error' => 0])->pushStatus(503)->push(['error' => 1])]);
        $owner = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Документ']);
        $version = $this->createVersion($document, 'original.docx', null);
        DB::table('office_drafts')->insert([
            'document_id' => $document->id, 'source_version_id' => $version->id,
            'storage_key' => 'working.docx', 'editor_key' => (string) Str::uuid(),
        ]);
        $document->delete();

        $url = '/api/v1/documents/' . $document->id . '/purge';
        $this->actingAs($owner)->deleteJson($url)->assertConflict();
        $this->deleteJson($url)->assertServiceUnavailable();
        $this->assertSoftDeleted($document);
        $this->assertDatabaseCount('outbox_events', 0);
        $this->assertDatabaseCount('audit_events', 0);

        $this->deleteJson($url)->assertOk();
        $this->assertDatabaseCount('office_drafts', 0);
    }

    private function createVersion(Document $document, string $key, ?string $preview): DocumentVersion
    {
        return $document->versions()->create([
            'number' => 1, 'creator_id' => $document->owner_id, 'storage_key' => $key, 'preview_key' => $preview,
            'original_name' => $key, 'mime' => 'text/plain', 'size' => 1, 'sha256' => str_repeat('a', 64), 'status' => 'ready',
        ]);
    }
}
