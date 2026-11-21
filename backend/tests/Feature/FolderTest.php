<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\Folder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class FolderTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_folder_returns_a_resource_and_preserves_the_depth_limit(): void
    {
        $owner = User::factory()->create();
        $this->actingAs($owner);

        $parentId = null;
        for ($depth = 1; $depth <= 5; $depth++) {
            $name = 'Folder ' . $depth;
            $folder = $this->postJson('/api/v1/folders', ['name' => $name, 'parent_id' => $parentId])
                ->assertCreated()
                ->assertJsonPath('data.name', $name)
                ->assertJsonPath('data.parent_id', $parentId)
                ->assertJsonPath('data.owner_id', $owner->id)
                ->assertJsonStructure(['data' => ['id', 'created_at', 'updated_at']]);

            $parentId = $folder->json('data.id');
        }

        $this->postJson('/api/v1/folders', ['name' => 'Too deep', 'parent_id' => $parentId])
            ->assertUnprocessable();
        $this->assertDatabaseCount('folders', 5);
    }

    public function test_create_folder_rejects_invalid_input_and_foreign_parents(): void
    {
        $owner = User::factory()->create();
        $parent = Folder::query()->create([
            'owner_id' => User::factory()->create()->id,
            'name' => 'Private folder',
        ]);

        $this->actingAs($owner)->postJson('/api/v1/folders', ['parent_id' => 'invalid'])
            ->assertUnprocessable()
            ->assertJsonStructure(['error' => ['details' => ['name', 'parent_id']]]);
        $this->postJson('/api/v1/folders', ['name' => 'Child', 'parent_id' => $parent->id])
            ->assertNotFound();
        $this->assertDatabaseCount('folders', 1);
    }

    public function test_document_can_only_be_moved_into_a_folder_owned_by_its_owner(): void
    {
        $owner = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Report']);
        $folder = Folder::query()->create(['owner_id' => $owner->id, 'name' => 'Reports']);
        $foreignFolder = Folder::query()->create(['owner_id' => User::factory()->create()->id, 'name' => 'Private']);
        $url = '/api/v1/documents/' . $document->id . '/folder';

        $this->actingAs($owner)->putJson($url, ['folder_id' => $foreignFolder->id])->assertUnprocessable();
        $this->assertNull($document->fresh()->folder_id);

        $this->putJson($url, ['folder_id' => $folder->id])->assertOk();
        $this->assertSame($folder->id, $document->fresh()->folder_id);

        $this->putJson($url, ['folder_id' => null])->assertOk();
        $this->assertNull($document->fresh()->folder_id);
    }
}
