<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Access\Services\DocumentAccess;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Services\UploadDocument;
use App\Modules\Integrations\Jobs\ProcessTransfer;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Services\ProviderFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CloudTransferTest extends TestCase
{
    use RefreshDatabase;

    public function test_connection_secrets_are_encrypted_and_other_admin_has_no_access(): void
    {
        $owner = User::factory()->create(['role' => 'employee']);
        $connection = CloudConnection::create(['owner_id' => $owner->id, 'provider' => 'yandex', 'name' => 'Personal', 'credentials' => ['token' => 'private-token']]);
        $this->assertStringNotContainsString('private-token', $connection->getRawOriginal('credentials'));
        $this->actingAs($owner)->getJson('/api/v1/connections')->assertOk()->assertJsonMissingPath('data.0.credentials');
        $admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($admin)->getJson('/api/v1/connections/'.$connection->id.'/files')->assertNotFound();
        $this->deleteJson('/api/v1/connections/'.$connection->id)->assertNotFound();
    }

    public function test_export_checks_revoked_permission_again_in_worker(): void
    {
        Http::preventStrayRequests();
        $owner = User::factory()->create(['role' => 'employee']);
        $actor = User::factory()->create(['role' => 'employee']);
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Confidential']);
        $doc->grants()->create(['user_id' => $actor->id, 'read' => true, 'export' => true]);
        $version = DocumentVersion::create(['document_id' => $doc->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'file.txt', 'original_name' => 'file.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text'), 'status' => 'ready']);
        $connection = CloudConnection::create(['owner_id' => $actor->id, 'provider' => 'yandex', 'name' => 'Disk', 'credentials' => ['token' => 'token']]);
        $response = $this->actingAs($actor)->postJson('/api/v1/transfers', ['connection_id' => $connection->id, 'direction' => 'export', 'path' => '/', 'filename' => 'file.txt', 'version_id' => $version->id], ['Idempotency-Key' => 'transfer-test-key'])->assertAccepted();
        $doc->grants()->delete();
        $job = new ProcessTransfer($response->json('data.id'));
        $job->handle(new ProviderFactory, new DocumentAccess, new UploadDocument);
        $this->assertDatabaseHas('cloud_transfers', ['id' => $job->transferId, 'status' => 'failed']);
        Http::assertNothingSent();
    }

    public function test_duplicate_export_delivery_does_not_repeat_remote_write(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('file.txt', 'text');
        Http::fake(['cloud-api.yandex.net/*' => Http::response(['href' => 'https://storage.yandex.net/upload']), 'storage.yandex.net/*' => Http::response('', 201)]);
        $user = User::factory()->create(['role' => 'employee']);
        $doc = Document::create(['owner_id' => $user->id, 'title' => 'File']);
        $version = DocumentVersion::create(['document_id' => $doc->id, 'creator_id' => $user->id, 'number' => 1, 'storage_key' => 'file.txt', 'original_name' => 'file.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text'), 'status' => 'ready']);
        $connection = CloudConnection::create(['owner_id' => $user->id, 'provider' => 'yandex', 'name' => 'Disk', 'credentials' => ['token' => 'secret']]);
        $transfer = CloudTransfer::create(['initiator_id' => $user->id, 'connection_id' => $connection->id, 'version_id' => $version->id, 'direction' => 'export', 'remote_path' => '/file.txt', 'filename' => 'file.txt']);
        $job = new ProcessTransfer($transfer->id);
        $job->handle(new ProviderFactory, new DocumentAccess, new UploadDocument);
        $job->handle(new ProviderFactory, new DocumentAccess, new UploadDocument);
        $this->assertSame('completed', $transfer->fresh()->status);
        Http::assertSentCount(2);
        Http::assertSent(fn ($request) => $request->url() === 'https://storage.yandex.net/upload' && ! $request->hasHeader('Authorization'));
    }
}
