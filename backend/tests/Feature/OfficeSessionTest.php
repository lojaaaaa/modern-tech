<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Collaboration\Services\OfficeTokens;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

require_once __DIR__.'/../../app/Modules/Collaboration/Services/OfficeTokens.php';
require_once __DIR__.'/../../app/Modules/Collaboration/Http/OfficeController.php';

class OfficeSessionTest extends TestCase
{
    use RefreshDatabase;

    public function test_session_is_shared_but_source_capability_rechecks_access(): void
    {
        config(['office.public_url' => 'http://localhost:8895', 'office.internal_url' => 'http://office-documentserver', 'office.app_internal_url' => 'http://gateway', 'office.jwt_secret' => 'test-office-secret']);
        Storage::fake('local');
        Storage::disk('local')->put('originals/source.docx', 'fixture');
        $owner = User::factory()->create(['active' => true, 'role' => 'employee']);
        $editor = User::factory()->create(['active' => true, 'role' => 'employee']);
        $reader = User::factory()->create(['active' => true, 'role' => 'employee']);
        $document = Document::create(['owner_id' => $owner->id, 'title' => 'Document']);
        $version = DocumentVersion::create(['document_id' => $document->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'originals/source.docx', 'original_name' => 'source.docx', 'mime' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'size' => 7, 'sha256' => str_repeat('a', 64), 'status' => 'ready']);
        $document->update(['published_version_id' => $version->id]);
        $document->grants()->create(['user_id' => $editor->id, 'read' => true, 'edit' => true, 'comment' => true, 'export' => false]);
        $document->grants()->create(['user_id' => $reader->id, 'read' => true, 'edit' => false, 'comment' => false, 'export' => false]);
        $url = '/api/v1/documents/'.$document->id.'/editor/session';
        $first = $this->actingAs($owner)->postJson($url)->assertOk()->json('config');
        $second = $this->actingAs($editor)->postJson($url)->assertOk()->json('config');
        $this->assertSame($first['document']['key'], $second['document']['key']);
        $this->assertNotSame('originals/source.docx', \DB::table('office_drafts')->where('document_id', $document->id)->value('storage_key'));
        $this->actingAs($reader)->postJson($url)->assertForbidden();
        $source = parse_url($second['document']['url'], PHP_URL_PATH);
        $this->get($source)->assertOk();
        $document->grants()->where('user_id', $editor->id)->delete();
        $this->get($source)->assertForbidden();
        $this->postJson('/api/v1/office/callback', ['token' => 'invalid'])->assertForbidden();
        $signed = app(OfficeTokens::class)->sign(['key' => $first['document']['key'], 'status' => 4]);
        $this->postJson('/api/v1/office/callback', ['token' => $signed])->assertOk()->assertJsonPath('error', 0);
        $this->assertNotSame($first['document']['key'], \DB::table('office_drafts')->where('document_id', $document->id)->value('editor_key'));
    }

    public function test_new_publication_uses_its_own_draft_and_late_saves_preserve_the_old_one(): void
    {
        config(['office.public_url' => 'http://localhost:8895', 'office.internal_url' => 'http://office-documentserver', 'office.app_internal_url' => 'http://gateway', 'office.jwt_secret' => 'test-office-secret']);
        Storage::fake('local');
        $storage = Storage::disk('local');
        $owner = User::factory()->create(['active' => true, 'role' => 'employee']);
        $editor = User::factory()->create(['active' => true, 'role' => 'employee']);
        $document = Document::create(['owner_id' => $owner->id, 'title' => 'Document']);
        $versions = [];
        foreach ([1, 2] as $number) {
            $path = 'originals/version-'.$number.'.docx';
            $storage->put($path, 'version '.$number);
            $versions[$number] = DocumentVersion::create(['document_id' => $document->id, 'creator_id' => $owner->id, 'number' => $number, 'storage_key' => $path, 'original_name' => 'source.docx', 'mime' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'size' => 9, 'sha256' => hash('sha256', 'version '.$number), 'status' => 'ready']);
        }
        $document->update(['published_version_id' => $versions[1]->id]);
        $document->grants()->create(['user_id' => $editor->id, 'read' => true, 'edit' => true, 'comment' => true, 'export' => false]);
        $url = '/api/v1/documents/'.$document->id.'/editor/session';
        $first = $this->actingAs($owner)->postJson($url)->assertOk()->json('config');
        $oldDraft = DB::table('office_drafts')->where('editor_key', $first['document']['key'])->first();
        $storage->put($oldDraft->storage_key, 'edited version 1');

        $document->update(['published_version_id' => $versions[2]->id]);
        $second = $this->postJson($url)->assertOk()->json('config');
        $this->assertNotSame($first['document']['key'], $second['document']['key']);
        $this->assertSame(2, DB::table('office_drafts')->where('document_id', $document->id)->count());
        $newDraft = DB::table('office_drafts')->where('editor_key', $second['document']['key'])->first();
        $this->assertSame($versions[2]->id, $newDraft->source_version_id);
        $this->assertSame('version 2', $storage->get($newDraft->storage_key));
        $this->assertSame('edited version 1', $storage->get($oldDraft->storage_key));
        $peer = $this->actingAs($editor)->postJson($url)->assertOk()->json('config');
        $this->assertSame($second['document']['key'], $peer['document']['key']);
        $this->get(parse_url($first['document']['url'], PHP_URL_PATH))->assertOk();

        $zip = new \ZipArchive;
        $zip->open($storage->path('saved.docx'), \ZipArchive::CREATE);
        $zip->addFromString('[Content_Types].xml', '<Types/>');
        $zip->addFromString('word/document.xml', '<document>late edit to version 1</document>');
        $zip->close();
        $saved = $storage->get('saved.docx');
        Http::preventStrayRequests();
        Http::fake(['http://office-documentserver/cache/old.docx' => Http::response($saved)]);
        $signed = app(OfficeTokens::class)->sign(['key' => $first['document']['key'], 'status' => 2, 'url' => 'http://localhost:8895/cache/old.docx']);
        $this->postJson('/api/v1/office/callback', ['token' => $signed])->assertOk()->assertJsonPath('error', 0);
        $oldAfterSave = DB::table('office_drafts')->where('document_id', $document->id)->where('source_version_id', $versions[1]->id)->first();
        $this->assertSame($saved, $storage->get($oldAfterSave->storage_key));
        $this->assertSame('version 2', $storage->get($newDraft->storage_key));
        $this->assertSame($second['document']['key'], DB::table('office_drafts')->where('source_version_id', $versions[2]->id)->value('editor_key'));
    }
}
