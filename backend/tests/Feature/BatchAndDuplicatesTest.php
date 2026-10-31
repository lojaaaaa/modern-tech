<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

final class BatchAndDuplicatesTest extends TestCase
{
    use RefreshDatabase;

    public function test_batch_denies_whole_operation_when_one_document_is_private(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $mine = Document::create(['owner_id' => $owner->id, 'title' => 'Mine']);
        $private = Document::create(['owner_id' => $other->id, 'title' => 'Private']);
        $this->actingAs($owner)->postJson('/api/v1/documents/batch', ['ids' => [$mine->id, $private->id], 'action' => 'trash'])->assertNotFound();
        $this->assertNull($mine->fresh()->deleted_at);
        $this->postJson('/api/v1/documents/batch', ['ids' => [$mine->id], 'action' => 'trash'])->assertOk();
        $this->assertSoftDeleted('documents', ['id' => $mine->id]);
        $this->postJson('/api/v1/documents/batch', ['ids' => [$mine->id], 'action' => 'restore'])->assertOk();
        $this->assertNull($mine->fresh()->deleted_at);
    }

    public function test_duplicate_check_does_not_disclose_private_matches(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Secret']);
        DocumentVersion::create(['document_id' => $doc->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'not-read', 'original_name' => 'note.txt', 'mime' => 'text/plain', 'size' => 12, 'sha256' => hash('sha256', 'same content'), 'status' => 'ready']);
        $file = fn () => UploadedFile::fake()->createWithContent('note.txt', 'same content');
        $this->actingAs($other)->postJson('/api/v1/documents/duplicates', ['file' => $file()])->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($owner)->postJson('/api/v1/documents/duplicates', ['file' => $file()])->assertOk()->assertJsonPath('data.0.id', $doc->id);
    }
}
