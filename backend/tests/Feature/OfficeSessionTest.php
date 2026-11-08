<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Collaboration\Services\OfficeTokens;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
}
