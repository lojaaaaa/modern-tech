<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class DocumentPolicyApiTest extends TestCase
{
    use RefreshDatabase;

    #[DataProvider('roles')]
    public function test_current_document_permissions_apply_to_the_card_and_version_resources(string $role, bool $owner, array $grants, array $permissions, int $readStatus, bool $active = true): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('original.png', 'image bytes');
        $actor = User::factory()->create(['role' => $role, 'active' => $active]);
        $documentOwner = $owner ? $actor : User::factory()->create();
        $document = Document::create(['owner_id' => $documentOwner->id, 'title' => 'Role matrix']);
        $version = DocumentVersion::create(['document_id' => $document->id, 'creator_id' => $documentOwner->id, 'number' => 1, 'storage_key' => 'original.png', 'original_name' => 'original.png', 'mime' => 'image/png', 'size' => 11, 'sha256' => hash('sha256', 'image bytes'), 'status' => 'ready', 'extracted_text' => 'Ready text']);
        $document->update(['published_version_id' => $version->id, 'desired_version_id' => $version->id]);
        if ($grants !== []) {
            $document->grants()->create(['user_id' => $actor->id] + $grants);
        }

        $this->actingAs($actor);
        $card = $this->getJson('/api/v1/documents/'.$document->id)->assertStatus($readStatus);
        if ($readStatus === 200) {
            $card->assertJsonPath('data.permissions', $permissions);
            $this->getJson('/api/v1/documents/'.$document->id.'/versions')->assertOk()->assertJsonPath('data.0.id', $version->id);
            $this->getJson('/api/v1/versions/'.$version->id.'/text')->assertOk()->assertJsonPath('data.text', 'Ready text');
            $this->getJson('/api/v1/versions/'.$version->id.'/entities')->assertOk()->assertJsonPath('data', []);
            $this->get('/api/v1/versions/'.$version->id.'/preview')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->assertStreamedContent('image bytes');
            $download = $this->getJson('/api/v1/versions/'.$version->id.'/download')->assertStatus($permissions['export'] ? 200 : 403);
            if ($permissions['export']) {
                $download->assertDownload('original.png')->assertStreamedContent('image bytes');
            }
            $this->getJson('/api/v1/documents/'.$document->id.'/comments')->assertOk()->assertJsonPath('data', []);
            $this->getJson('/api/v1/documents/'.$document->id.'/grants')->assertStatus($permissions['manage'] ? 200 : 403);
            $this->patchJson('/api/v1/documents/'.$document->id, ['title' => 'Updated title', 'revision' => 1])->assertStatus($permissions['edit'] ? 200 : 403);
            $this->getJson('/api/v1/documents/'.$document->id)->assertOk()->assertJsonPath('data.title', $permissions['edit'] ? 'Updated title' : 'Role matrix');
            $this->postJson('/api/v1/documents/'.$document->id.'/comments', ['body' => 'Review note', 'version_id' => $version->id])->assertStatus($permissions['comment'] ? 201 : 403);
            $comments = $this->getJson('/api/v1/documents/'.$document->id.'/comments')->assertOk()->assertJsonCount($permissions['comment'] ? 1 : 0, 'data');
            if ($permissions['comment']) {
                $comments->assertJsonPath('data.0.body', 'Review note')->assertJsonPath('data.0.author_id', $actor->id);
            }
        } else {
            foreach (['download', 'preview', 'entities', 'text'] as $resource) {
                $this->actingAs($actor)->getJson('/api/v1/versions/'.$version->id.'/'.$resource)->assertStatus($readStatus);
            }
            $this->actingAs($actor)->getJson('/api/v1/documents/'.$document->id.'/versions')->assertStatus($readStatus);
            $this->actingAs($actor)->postJson('/api/v1/documents/'.$document->id.'/comments', ['body' => 'Attack', 'version_id' => $version->id])->assertStatus($readStatus);
        }
    }

    public static function roles(): array
    {
        $all = ['read' => true, 'comment' => true, 'edit' => true, 'export' => true, 'manage' => true];
        $read = ['read' => true, 'comment' => false, 'edit' => false, 'export' => false, 'manage' => false];

        return [
            'owner' => ['employee', true, [], $all, 200],
            'administrator' => ['admin', false, [], $all, 200],
            'editor' => ['employee', false, ['read' => true, 'edit' => true], array_replace($read, ['edit' => true]), 200],
            'commentator' => ['employee', false, ['read' => true, 'comment' => true], array_replace($read, ['comment' => true]), 200],
            'reader' => ['employee', false, ['read' => true], $read, 200],
            'exporter' => ['employee', false, ['read' => true, 'export' => true], array_replace($read, ['export' => true]), 200],
            'observer cannot gain writes from grants' => ['observer', false, ['read' => true, 'comment' => true, 'edit' => true, 'export' => true], $read, 200],
            'observer owner' => ['observer', true, [], $read, 200],
            'stranger' => ['employee', false, [], [], 404],
            'additional grants without read' => ['employee', false, ['read' => false, 'comment' => true, 'edit' => true, 'export' => true], [], 404],
            'blocked administrator' => ['admin', false, [], [], 401, false],
        ];
    }

    public function test_an_accessible_document_does_not_authorize_a_foreign_version(): void
    {
        $actor = User::factory()->create();
        $other = User::factory()->create();
        $document = Document::create(['owner_id' => $actor->id, 'title' => 'Accessible']);
        $private = Document::create(['owner_id' => $other->id, 'title' => 'Private']);
        $foreignVersion = DocumentVersion::create(['document_id' => $private->id, 'creator_id' => $other->id, 'number' => 1, 'storage_key' => 'private.png', 'original_name' => 'private.png', 'mime' => 'image/png', 'size' => 7, 'sha256' => hash('sha256', 'private'), 'status' => 'ready', 'extracted_text' => 'Private content']);

        $this->actingAs($actor)->getJson('/api/v1/documents/'.$document->id)->assertOk();
        $this->postJson('/api/v1/documents/'.$document->id.'/comments', ['body' => 'Wrong version', 'version_id' => $foreignVersion->id])->assertUnprocessable();
        $this->getJson('/api/v1/documents/'.$document->id.'/comments')->assertOk()->assertJsonPath('data', []);
        foreach (['preview', 'download', 'text', 'entities'] as $resource) {
            $this->getJson('/api/v1/versions/'.$foreignVersion->id.'/'.$resource)->assertNotFound();
        }
    }

    public function test_private_documents_are_excluded_before_search_count_and_pagination(): void
    {
        $actor = User::factory()->create();
        $owner = User::factory()->create();
        $shared = Document::create(['owner_id' => $owner->id, 'title' => 'Common visible']);
        $shared->grants()->create(['user_id' => $actor->id, 'read' => true]);
        $published = DocumentVersion::create(['document_id' => $shared->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'public.pdf', 'original_name' => 'public.pdf', 'mime' => 'application/pdf', 'size' => 7, 'sha256' => hash('sha256', 'public'), 'status' => 'ready']);
        $candidate = DocumentVersion::create(['document_id' => $shared->id, 'creator_id' => $owner->id, 'number' => 2, 'storage_key' => 'candidate.docx', 'original_name' => 'candidate.docx', 'mime' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'size' => 100, 'sha256' => hash('sha256', 'candidate'), 'status' => 'failed']);
        $shared->update(['published_version_id' => $published->id, 'desired_version_id' => $candidate->id]);
        Document::create(['owner_id' => $actor->id, 'title' => 'Common unpublished']);
        for ($i = 0; $i < 3; $i++) {
            Document::create(['owner_id' => $owner->id, 'title' => 'Common private '.$i]);
        }

        $this->actingAs($actor)->getJson('/api/v1/search?q=Common&per_page=1')
            ->assertOk()->assertJsonPath('meta.total', 1)->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $shared->id)->assertJsonPath('data.0.snippet', null)
            ->assertJsonPath('data.0.version.id', $published->id)->assertJsonPath('data.0.processing_status', 'ready');
        $this->getJson('/api/v1/search?q=Common&format=docx')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/search?q=Common&status=failed')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/search?q=Common&per_page=1&page=2')
            ->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data', []);
    }
}
