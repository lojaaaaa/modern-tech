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
            $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Shared '.$i]);
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
        $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Secret strategy']);
        $this->actingAs($other)->getJson('/api/v1/documents/'.$doc->id)->assertNotFound();
        $this->getJson('/api/v1/documents')->assertOk()->assertJsonPath('meta.total', 0);
        $this->actingAs($admin)->getJson('/api/v1/documents/'.$doc->id)->assertOk()->assertJsonPath('data.permissions.manage', true);
    }

    public function test_reader_cannot_edit_or_export_and_revoke_is_immediate(): void
    {
        $owner = $this->employee();
        $reader = $this->employee();
        $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Shared']);
        $doc->grants()->create(['user_id' => $reader->id, 'read' => true]);
        $this->actingAs($reader)->getJson('/api/v1/documents/'.$doc->id)->assertOk()->assertJsonPath('data.permissions.export', false);
        $this->patchJson('/api/v1/documents/'.$doc->id, ['title' => 'Attack', 'revision' => 1])->assertForbidden();
        $doc->grants()->delete();
        $this->getJson('/api/v1/documents/'.$doc->id)->assertNotFound();
    }

    public function test_restore_only_finds_deleted_documents_and_checks_access(): void
    {
        $owner = $this->employee();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Archived report']);
        $url = '/api/v1/documents/' . $document->id . '/restore';

        $this->actingAs($owner)->postJson($url)->assertNotFound();
        $document->delete();
        $this->actingAs($this->employee())->postJson($url)->assertNotFound();
        $this->assertSoftDeleted($document);

        $this->actingAs($owner)->postJson($url)->assertOk()->assertJsonPath('data.id', $document->id);
        $this->assertNotSoftDeleted($document);
    }

    public function test_observer_cannot_receive_write_grant(): void
    {
        $owner = $this->employee();
        $observer = $this->employee('observer');
        $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Doc']);
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
        $this->postJson(
            '/api/v1/documents',
            ['file' => $upload(), 'title' => 'Different title'],
            ['Idempotency-Key' => 'upload-test-123'],
        )->assertConflict();

        $this->assertDatabaseHas('idempotency_records', [
            'user_id' => $user->id,
            'scope' => 'upload:new',
            'key' => 'upload-test-123',
            'request_hash' => hash('sha256', hash('sha256', 'Hello reliable document pipeline') . '||upload:new'),
            'resource_id' => $first->json('data.id'),
        ]);
        $this->assertDatabaseCount('documents', 1);
        $this->assertDatabaseCount('document_versions', 1);
        $this->assertDatabaseCount('outbox_events', 1);
        $this->assertCount(1, Storage::disk('local')->allFiles());
    }

    public function test_last_admin_cannot_be_disabled(): void
    {
        $admin = $this->employee('admin');
        $this->actingAs($admin)->patchJson('/api/v1/users/'.$admin->id, ['is_active' => false])->assertConflict();
        $this->assertTrue($admin->fresh()->active);
    }

    public function test_upload_and_add_version_both_require_an_idempotency_key(): void
    {
        $owner = $this->employee();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Original']);
        $file = fn () => UploadedFile::fake()->createWithContent('note.txt', 'Upload contents');

        $this->actingAs($owner)->postJson('/api/v1/documents', ['file' => $file()])
            ->assertUnprocessable()
            ->assertJsonPath('error.message', __('documents.invalid_idempotency_key'));
        $this->postJson(
            '/api/v1/documents/' . $document->id . '/versions',
            ['file' => $file()],
            ['Idempotency-Key' => 'short'],
        )->assertUnprocessable()->assertJsonPath('error.message', __('documents.invalid_idempotency_key'));

        $this->assertDatabaseCount('document_versions', 0);
        $this->assertDatabaseCount('idempotency_records', 0);
    }

    public function test_optimistic_lock_rejects_stale_revision(): void
    {
        $owner = $this->employee();
        $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Original']);
        $this->actingAs($owner)->patchJson('/api/v1/documents/'.$doc->id, ['title' => 'First', 'revision' => 1])
            ->assertOk()
            ->assertJsonPath('data.title', 'First')
            ->assertJsonPath('data.revision', 2);
        $this->patchJson('/api/v1/documents/'.$doc->id, ['title' => 'Stale', 'revision' => 1])->assertConflict();
        $this->assertSame('First', $doc->fresh()->title);
        $this->assertDatabaseCount('audit_events', 1);
        $this->assertDatabaseHas('audit_events', [
            'actor_id' => $owner->id,
            'action' => 'document.updated',
            'resource_id' => $doc->id,
        ]);
    }

    public function test_document_mutations_authorize_before_validating_input(): void
    {
        $owner = $this->employee();
        $reader = $this->employee();
        $stranger = $this->employee();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Original']);
        $document->grants()->create(['user_id' => $reader->id, 'read' => true]);
        $url = '/api/v1/documents/'.$document->id;

        $this->actingAs($stranger)->patchJson($url, [])->assertNotFound();
        $this->putJson($url.'/grants', [])->assertNotFound();
        $this->actingAs($reader)->patchJson($url, [])->assertForbidden();
        $this->putJson($url.'/grants', [])->assertForbidden();
        $this->actingAs($owner)->patchJson($url, [])->assertUnprocessable();
        $this->putJson($url.'/grants', ['grants' => []])->assertUnprocessable();

        $this->assertSame('Original', $document->fresh()->title);
        $this->assertDatabaseCount('document_grants', 1);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_replacing_grants_updates_only_the_target_and_batches_participant_lookup(): void
    {
        $owner = $this->employee();
        $formerReader = $this->employee();
        $editor = $this->employee();
        $observer = $this->employee('observer');
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Current']);
        $otherDocument = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Other']);
        $document->grants()->create(['user_id' => $formerReader->id, 'read' => true]);
        $otherDocument->grants()->create(['user_id' => $formerReader->id, 'read' => true]);
        $url = '/api/v1/documents/'.$document->id;
        $grants = [
            [
                'user_id' => (string) $editor->id, 'read' => '1', 'comment' => '0', 'edit' => '1', 'export' => '0',
                'document_id' => $otherDocument->id,
            ],
            ['user_id' => $observer->id, 'read' => true, 'comment' => false, 'edit' => false, 'export' => false],
        ];

        DB::enableQueryLog();
        try {
            $this->actingAs($owner)->putJson($url.'/grants', ['grants' => $grants])
                ->assertOk()
                ->assertJsonCount(2, 'data')
                ->assertJsonPath('data.0.document_id', $document->id)
                ->assertJsonPath('data.0.user_id', $editor->id)
                ->assertJsonPath('data.0.edit', true)
                ->assertJsonPath('data.0.comment', false)
                ->assertJsonPath('data.1.user_id', $observer->id);
            $userQueries = array_filter(DB::getQueryLog(), fn (array $query) => str_contains($query['query'], 'from "users"'));
            $this->assertCount(1, $userQueries);
        } finally {
            DB::disableQueryLog();
            DB::flushQueryLog();
        }

        $this->assertDatabaseMissing('document_grants', ['document_id' => $document->id, 'user_id' => $formerReader->id]);
        $this->assertDatabaseHas('document_grants', ['document_id' => $otherDocument->id, 'user_id' => $formerReader->id]);
        $this->assertDatabaseCount('audit_events', 1);
        $this->assertDatabaseHas('audit_events', ['action' => 'document.grants.updated', 'resource_id' => $document->id]);
    }

    public function test_an_invalid_grant_leaves_existing_permissions_and_audit_untouched(): void
    {
        $owner = $this->employee();
        $reader = $this->employee();
        $observer = $this->employee('observer');
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Private']);
        $document->grants()->create(['user_id' => $reader->id, 'read' => true]);
        $url = '/api/v1/documents/'.$document->id.'/grants';
        $read = ['user_id' => $reader->id, 'read' => true, 'comment' => false, 'edit' => false, 'export' => false];
        $this->actingAs($owner);

        $this->putJson($url, ['grants' => [$read, array_replace($read, ['user_id' => $observer->id + 1])]])
            ->assertUnprocessable()
            ->assertJsonStructure(['error' => ['details' => ['grants.1.user_id']]]);
        $this->putJson($url, ['grants' => [$read, array_replace($read, ['user_id' => $observer->id, 'edit' => true])]])
            ->assertUnprocessable()
            ->assertJsonPath('error.message', __('documents.observer_can_only_read'));
        $this->putJson($url, ['grants' => [array_replace($read, ['read' => false, 'export' => true])]])
            ->assertUnprocessable()
            ->assertJsonPath('error.message', __('documents.additional_permissions_require_read'));

        $this->assertDatabaseCount('document_grants', 1);
        $this->assertDatabaseHas('document_grants', ['document_id' => $document->id, 'user_id' => $reader->id, 'read' => true]);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_trashed_document_is_hidden_from_readers(): void
    {
        $owner = $this->employee();
        $reader = $this->employee();
        $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Gone']);
        $doc->grants()->create(['user_id' => $reader->id, 'read' => true]);
        $this->actingAs($owner)->deleteJson('/api/v1/documents/'.$doc->id)->assertOk();
        $this->actingAs($reader)->getJson('/api/v1/documents?trash=1')->assertOk()->assertJsonPath('meta.total', 0);
    }
}
