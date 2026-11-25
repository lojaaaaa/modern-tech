<?php

declare(strict_types=1);

namespace Tests\Feature\Actions;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;
use ZipArchive;

final class PublishOfficeDraftActionTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_a_closed_saved_draft_can_be_submitted_once_for_publication(): void
    {
        config(['office.internal_url' => 'http://office.test', 'office.jwt_secret' => str_repeat('s', 32)]);
        Http::fake(['http://office.test/*' => Http::sequence()->push(['error' => 0])->push(['error' => 1])->push(['error' => 1])]);
        $disk = Storage::fake('local');
        $owner = User::factory()->create();
        $editor = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Документ']);
        $document->grants()->create(['user_id' => $editor->id, 'read' => true, 'edit' => true]);
        $version = $document->versions()->create([
            'number' => 1, 'creator_id' => $owner->id, 'storage_key' => 'source.docx',
            'original_name' => 'source.docx', 'mime' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'size' => 3, 'sha256' => hash('sha256', 'old'), 'status' => 'ready',
        ]);
        $document->update(['published_version_id' => $version->id, 'desired_version_id' => $version->id]);

        $zip = new ZipArchive();
        $this->assertTrue($zip->open($disk->path('saved.docx'), ZipArchive::CREATE));
        $zip->addFromString('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            . '</Types>');
        $zip->addFromString('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            . '</Relationships>');
        $zip->addFromString('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
        $zip->close();
        DB::table('office_drafts')->insert([
            'document_id' => $document->id, 'source_version_id' => $version->id,
            'storage_key' => 'saved.docx', 'editor_key' => (string) Str::uuid(),
        ]);

        $url = '/api/v1/documents/' . $document->id . '/draft/publication';
        $headers = ['Idempotency-Key' => 'saved-draft-test'];
        $this->actingAs($editor)->postJson($url, [], $headers)->assertForbidden();
        $this->actingAs($owner)->postJson($url, [], $headers)->assertConflict();
        $this->getJson($url)->assertOk()->assertJsonPath('data.available', true);
        $this->postJson($url, [], $headers)->assertAccepted()->assertJsonPath('data.version.id', $version->id);
        $this->postJson($url, [], $headers)->assertAccepted();
        $this->assertDatabaseCount('document_versions', 2);
        $this->assertDatabaseCount('outbox_events', 1);
        $this->assertSame($version->id, $document->fresh()->published_version_id);
        $this->assertNotSame($version->id, $document->fresh()->desired_version_id);
        $disk->assertExists('saved.docx');
    }
}
