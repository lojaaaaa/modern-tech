<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DocumentAccessTest extends TestCase
{
    use RefreshDatabase;

    private function employee(string $role = 'employee'): User
    {
        return User::factory()->create(['role' => $role, 'active' => true]);
    }

    public function test_library_permissions_do_not_query_grants_for_each_row(): void
    {
        $owner = $this->employee();
        $reader = $this->employee();
        for ($i = 0; $i < 25; $i++) {
            $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Shared '.$i]);
            $doc->grants()->create(['user_id' => $reader->id, 'read' => true, 'comment' => true]);
        }
        DB::enableQueryLog();
        $this->actingAs($reader)->getJson('/api/v1/documents')->assertOk()->assertJsonPath('meta.total', 25)->assertJsonPath('data.0.permissions.comment', true)->assertJsonPath('data.0.permissions.export', false);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();
        $this->assertLessThan(20, count($queries), 'Library must batch grants instead of running permission queries per row.');
    }

    public function test_private_document_is_invisible_but_admin_can_read(): void
    {
        $owner = $this->employee();
        $other = $this->employee();
        $admin = $this->employee('admin');
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Secret strategy']);
        $this->actingAs($other)->getJson('/api/v1/documents/'.$doc->id)->assertNotFound();
        $this->getJson('/api/v1/documents?q=Secret')->assertOk()->assertJsonPath('meta.total', 0);
        $this->actingAs($admin)->getJson('/api/v1/documents/'.$doc->id)->assertOk()->assertJsonPath('data.permissions.manage', true);
    }

    public function test_reader_cannot_edit_or_export_and_revoke_is_immediate(): void
    {
        $owner = $this->employee();
        $reader = $this->employee();
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Shared']);
        $doc->grants()->create(['user_id' => $reader->id, 'read' => true]);
        $this->actingAs($reader)->getJson('/api/v1/documents/'.$doc->id)->assertOk()->assertJsonPath('data.permissions.export', false);
        $this->patchJson('/api/v1/documents/'.$doc->id, ['title' => 'Attack', 'revision' => 1])->assertForbidden();
        $doc->grants()->delete();
        $this->getJson('/api/v1/documents/'.$doc->id)->assertNotFound();
    }

    public function test_observer_cannot_receive_write_grant(): void
    {
        $owner = $this->employee();
        $observer = $this->employee('observer');
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Doc']);
        $this->actingAs($owner)->putJson('/api/v1/documents/'.$doc->id.'/grants', ['grants' => [['user_id' => $observer->id, 'read' => true, 'comment' => true, 'edit' => false, 'export' => false]]])->assertUnprocessable();
    }

    public function test_upload_retry_is_idempotent_and_outbox_is_transactional(): void
    {
        Storage::fake('local');
        $user = $this->employee();
        $this->actingAs($user);
        $upload = fn () => UploadedFile::fake()->createWithContent('note.txt', 'Hello reliable document pipeline');
        $first = $this->postJson('/api/v1/documents', ['file' => $upload()], ['Idempotency-Key' => 'upload-test-123'])->assertAccepted();
        $this->postJson('/api/v1/documents', ['file' => $upload()], ['Idempotency-Key' => 'upload-test-123'])->assertAccepted()->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertDatabaseCount('documents', 1);
        $this->assertDatabaseCount('document_versions', 1);
        $this->assertDatabaseCount('outbox_events', 1);
        $this->assertCount(1, Storage::disk('local')->allFiles());
    }

    public function test_last_admin_cannot_be_disabled(): void
    {
        $admin = $this->employee('admin');
        $this->actingAs($admin)->patchJson('/api/v1/users/'.$admin->id, ['active' => false])->assertConflict();
        $this->assertTrue($admin->fresh()->active);
    }

    public function test_optimistic_lock_rejects_stale_revision(): void
    {
        $owner = $this->employee();
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Original']);
        $this->actingAs($owner)->patchJson('/api/v1/documents/'.$doc->id, ['title' => 'First', 'revision' => 1])->assertOk();
        $this->patchJson('/api/v1/documents/'.$doc->id, ['title' => 'Stale', 'revision' => 1])->assertConflict();
        $this->assertSame('First', $doc->fresh()->title);
    }

    public function test_trashed_document_is_hidden_from_readers(): void
    {
        $owner = $this->employee();
        $reader = $this->employee();
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Gone']);
        $doc->grants()->create(['user_id' => $reader->id, 'read' => true]);
        $this->actingAs($owner)->deleteJson('/api/v1/documents/'.$doc->id)->assertOk();
        $this->actingAs($reader)->getJson('/api/v1/documents?trash=1')->assertOk()->assertJsonPath('meta.total', 0);
    }
}
