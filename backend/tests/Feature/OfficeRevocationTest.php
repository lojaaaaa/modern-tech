<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class OfficeRevocationTest extends TestCase
{
    use RefreshDatabase;

    private function workspace(): array
    {
        config(['office.internal_url' => 'http://office-documentserver', 'office.jwt_secret' => 'test-office']);
        $owner = User::factory()->create(['role' => 'employee', 'active' => true]);
        $editor = User::factory()->create(['role' => 'employee', 'active' => true]);
        $document = Document::create(['owner_id' => $owner->id, 'title' => 'QA']);
        $version = DocumentVersion::create(['document_id' => $document->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'qa', 'original_name' => 'qa.docx', 'mime' => 'application/octet-stream', 'size' => 1, 'sha256' => str_repeat('a', 64), 'status' => 'ready']);
        DB::table('office_drafts')->insert(['document_id' => $document->id, 'source_version_id' => $version->id, 'editor_key' => 'qa-key', 'storage_key' => 'qa-draft', 'created_at' => now(), 'updated_at' => now()]);
        $document->grants()->create(['user_id' => $editor->id, 'read' => true, 'edit' => true]);
        return [$owner, $editor, $document];
    }

    public function test_revocation_drops_office_editor_and_denies_future_document_access(): void
    {
        [$owner, $editor, $document] = $this->workspace();
        Http::fake(['http://office-documentserver/command*' => Http::response(['error' => 0])]);
        $this->actingAs($owner)->putJson('/api/v1/documents/'.$document->id.'/grants', ['revision' => 1, 'grants' => []])->assertOk();
        Http::assertSent(fn ($request) => $request['c'] === 'drop' && $request['key'] === 'qa-key' && $request['users'] === [(string) $editor->id]);
        $this->actingAs($editor)->getJson('/api/v1/documents/'.$document->id)->assertNotFound();
    }

    public function test_failed_office_disconnect_rolls_back_permission_change(): void
    {
        [$owner, $editor, $document] = $this->workspace();
        Http::fake(['http://office-documentserver/command*' => Http::response(['error' => 3], 500)]);
        $this->actingAs($owner)->putJson('/api/v1/documents/'.$document->id.'/grants', ['revision' => 1, 'grants' => []])->assertStatus(503);
        $this->assertTrue($document->grants()->where('user_id', $editor->id)->exists());
        $this->assertSame(1, $document->fresh()->revision);
    }

    public function test_blocking_account_also_drops_office_session(): void
    {
        [, $editor] = $this->workspace();
        $admin = User::factory()->create(['role' => 'admin', 'active' => true]);
        Http::fake(['http://office-documentserver/command*' => Http::response(['error' => 0])]);
        $this->actingAs($admin)->patchJson('/api/v1/users/'.$editor->id, ['is_active' => false])->assertOk();
        Http::assertSent(fn ($request) => $request['c'] === 'drop' && $request['users'] === [(string) $editor->id]);
        $this->assertFalse($editor->fresh()->active);
    }
}
