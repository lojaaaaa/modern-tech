<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Documents\Services\UploadDocument;
use App\Modules\Integrations\Enums\CloudTransferStatus;
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
        $connection = CloudConnection::query()->create(['owner_id' => $owner->id, 'provider' => 'mail', 'name' => 'Personal', 'credentials' => ['email' => 'test@example.test', 'password' => 'private-token']]);
        $this->assertStringNotContainsString('private-token', $connection->getRawOriginal('credentials'));
        $this->actingAs($owner)->getJson('/api/v1/connections')->assertOk()->assertJsonMissingPath('data.0.credentials');
        $admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($admin)->getJson('/api/v1/connections/'.$connection->id.'/files')->assertNotFound();
        $this->deleteJson('/api/v1/connections/'.$connection->id)->assertNotFound();
    }

    public function test_mail_file_listing_reports_rejected_or_missing_app_credentials(): void
    {
        Http::preventStrayRequests();
        Http::fake(['webdav.cloud.mail.ru/*' => Http::response('', 401)]);

        $owner = User::factory()->create();
        $connection = CloudConnection::query()->create([
            'owner_id' => $owner->id,
            'provider' => 'mail',
            'name' => 'Mail disk',
            'credentials' => ['email' => 'mail@example.test', 'password' => 'app-password'],
        ]);

        $endpoint = '/api/v1/connections/'.$connection->id.'/files';
        $message = 'Mail отклонил данные доступа. Проверьте почту и пароль приложения с доступом к Облаку.';
        $this->actingAs($owner)->getJson($endpoint)->assertUnprocessable()
            ->assertJsonPath('error.code', 'HTTP_422')->assertJsonPath('error.message', $message);
        Http::assertSent(fn ($request) => $request->url() === 'https://webdav.cloud.mail.ru/' && $request->method() === 'PROPFIND');

        $connection->update(['credentials' => []]);
        $this->getJson($endpoint)->assertUnprocessable()->assertJsonPath('error.message', $message);
        Http::assertSentCount(1);
    }

    public function test_export_checks_revoked_permission_again_in_worker(): void
    {
        Http::preventStrayRequests();
        $owner = User::factory()->create(['role' => 'employee']);
        $actor = User::factory()->create(['role' => 'employee']);
        $doc = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Confidential']);
        $doc->grants()->create(['user_id' => $actor->id, 'read' => true, 'export' => true]);
        $version = DocumentVersion::query()->create(['document_id' => $doc->id, 'creator_id' => $owner->id, 'number' => 1, 'storage_key' => 'file.txt', 'original_name' => 'file.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text'), 'status' => 'ready']);
        $doc->update(['published_version_id' => $version->id, 'desired_version_id' => $version->id]);
        $connection = CloudConnection::query()->create(['owner_id' => $actor->id, 'provider' => 'mail', 'name' => 'Disk', 'credentials' => ['email' => 'test@example.test', 'password' => 'token']]);
        $payload = [
            'connection_id' => $connection->id,
            'direction' => 'export',
            'path' => '/',
            'filename' => 'file.txt',
            'version_id' => $version->id,
        ];
        $headers = ['Idempotency-Key' => 'transfer-test-key'];
        $response = $this->actingAs($actor)->postJson('/api/v1/transfers', $payload, $headers)->assertAccepted();
        $this->postJson('/api/v1/transfers', array_reverse($payload, true), $headers)->assertAccepted()
            ->assertJsonPath('data.id', $response->json('data.id'));
        $this->assertDatabaseHas('idempotency_records', [
            'resource_id' => $response->json('data.id'),
            'request_hash' => hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR)),
        ]);
        $doc->grants()->delete();
        $job = new ProcessTransfer($response->json('data.id'));
        $job->handle(app(ProviderFactory::class), app(UploadDocument::class), app(DocumentPolicy::class));
        $this->assertDatabaseHas('cloud_transfers', ['id' => $job->transferId, 'status' => 'failed']);
        Http::assertNothingSent();
    }

    public function test_duplicate_export_delivery_does_not_repeat_remote_write(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('file.txt', 'text');
        Http::fake(['webdav.cloud.mail.ru/*' => Http::response('', 201)]);
        $user = User::factory()->create(['role' => 'employee']);
        $doc = Document::query()->create(['owner_id' => $user->id, 'title' => 'File']);
        $version = DocumentVersion::query()->create(['document_id' => $doc->id, 'creator_id' => $user->id, 'number' => 1, 'storage_key' => 'file.txt', 'original_name' => 'file.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text'), 'status' => 'ready']);
        $connection = CloudConnection::query()->create(['owner_id' => $user->id, 'provider' => 'mail', 'name' => 'Disk', 'credentials' => ['email' => 'test@example.test', 'password' => 'secret']]);
        $transfer = CloudTransfer::query()->create(['initiator_id' => $user->id, 'connection_id' => $connection->id, 'version_id' => $version->id, 'direction' => 'export', 'remote_path' => '/file.txt', 'filename' => 'file.txt']);
        $job = new ProcessTransfer($transfer->id);
        $job->handle(app(ProviderFactory::class), app(UploadDocument::class), app(DocumentPolicy::class));
        $job->handle(app(ProviderFactory::class), app(UploadDocument::class), app(DocumentPolicy::class));
        $this->assertSame(CloudTransferStatus::COMPLETED, $transfer->fresh()->status);
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $request->url() === 'https://webdav.cloud.mail.ru/file.txt' && $request->method() === 'PUT');
    }

    public function test_import_validates_downloaded_contents_before_quarantine(): void
    {
        Storage::fake('local');
        Http::preventStrayRequests();
        Http::fake([
            'webdav.cloud.mail.ru/*' => fn () => Http::response('Plain text from the cloud'),
        ]);

        $user = User::factory()->create();
        $connection = CloudConnection::query()->create([
            'owner_id' => $user->id,
            'provider' => 'mail',
            'name' => 'Disk',
            'credentials' => ['email' => 'test@example.test', 'password' => 'token'],
        ]);
        $attributes = [
            'initiator_id' => $user->id,
            'connection_id' => $connection->id,
            'direction' => 'import',
            'remote_path' => '/incoming',
        ];
        $invalid = CloudTransfer::query()->create($attributes + ['filename' => 'report.pdf']);
        $valid = CloudTransfer::query()->create($attributes + ['filename' => 'report.txt']);
        $providers = app(ProviderFactory::class);
        $uploads = app(UploadDocument::class);

        (new ProcessTransfer($invalid->id))->handle($providers, $uploads, app(DocumentPolicy::class));
        $this->assertSame(CloudTransferStatus::FAILED, $invalid->fresh()->status);
        $this->assertSame('TRANSFER_FAILED', $invalid->fresh()->error_code);
        $this->assertDatabaseCount('document_versions', 0);
        $this->assertSame([], Storage::disk('local')->allFiles());

        (new ProcessTransfer($valid->id))->handle($providers, $uploads, app(DocumentPolicy::class));
        $this->assertSame(CloudTransferStatus::COMPLETED, $valid->fresh()->status, $valid->fresh()->error_code ?? '');
        $this->assertDatabaseHas('document_versions', [
            'document_id' => $valid->fresh()->document_id,
            'original_name' => 'report.txt',
            'status' => 'quarantined',
        ]);
    }
}
