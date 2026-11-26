<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Integrations\Services\GoogleDisk;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AuditRegressionTest extends TestCase
{
    use RefreshDatabase;

    public function test_last_grant_can_be_removed(): void
    {
        $owner = User::factory()->create(['active' => true,'role' => 'employee']);
        $reader = User::factory()->create(['active' => true,'role' => 'employee']);
        $document = Document::create(['owner_id' => $owner->id,'title' => 'QA']);
        $document->grants()->create(['user_id' => $reader->id,'read' => true,'comment' => false,'edit' => false,'export' => false]);
        $this->actingAs($owner)->putJson('/api/v1/documents/'.$document->id.'/grants', ['revision' => 1, 'grants' => []])
            ->assertOk();
        $this->assertSame(0, $document->grants()->count());
    }

    public function test_stale_manager_snapshot_cannot_restore_revoked_grant(): void
    {
        $owner = User::factory()->create(['active' => true,'role' => 'employee']);
        $a = User::factory()->create(['active' => true,'role' => 'employee']);
        $b = User::factory()->create(['active' => true,'role' => 'employee']);
        $c = User::factory()->create(['active' => true,'role' => 'employee']);
        $document = Document::create(['owner_id' => $owner->id,'title' => 'QA']);
        $grant = fn ($user) => ['user_id' => $user->id,'read' => true,'comment' => false,'edit' => false,'export' => false];
        $url = '/api/v1/documents/'.$document->id.'/grants';
        $this->actingAs($owner)->putJson($url, ['revision' => 1, 'grants' => [$grant($a),$grant($b)]])->assertOk();
        $this->putJson($url, ['revision' => 2, 'grants' => [$grant($b)]])->assertOk();
        $this->assertFalse($document->grants()->where('user_id', $a->id)->exists());
        $this->putJson($url, ['revision' => 2, 'grants' => [$grant($a),$grant($b),$grant($c)]])->assertStatus(409);
        $this->assertFalse($document->grants()->where('user_id', $a->id)->exists());
    }

    public function test_historical_entities_remain_protected(): void
    {
        $owner = User::factory()->create(['active' => true,'role' => 'employee']);
        $document = Document::create(['owner_id' => $owner->id,'title' => 'QA']);
        $attributes = ['document_id' => $document->id,'creator_id' => $owner->id,'storage_key' => 'qa','original_name' => 'qa.txt','mime' => 'text/plain','size' => 4,'sha256' => str_repeat('a', 64),'status' => 'ready'];
        $old = DocumentVersion::create($attributes + ['number' => 1]);
        $current = DocumentVersion::create($attributes + ['number' => 2]);
        $document->update(['published_version_id' => $current->id,'desired_version_id' => $current->id]);
        $this->actingAs($owner)->getJson('/api/v1/versions/'.$old->id.'/entities')->assertNotFound();
        $this->getJson('/api/v1/versions/'.$current->id.'/entities')->assertOk();
    }

    public function test_google_download_refreshes_rejected_token(): void
    {
        Http::fake(['www.googleapis.com/*' => Http::sequence()->push('', 401)->push('binary', 200)]);
        $refreshed = false;
        $provider = new GoogleDisk('expired', function () use (&$refreshed) {
            $refreshed = true;
            return 'fresh';
        });
        $path = tempnam(sys_get_temp_dir(), 'qa-google-');
        try {
            $provider->download('/@test-id', $path);
            $this->assertTrue($refreshed);
            Http::assertSentCount(2);
        } finally {
            unlink($path);
        }
    }

    public function test_office_save_queues_previous_draft_file_for_cleanup(): void
    {
        config(['office.public_url' => 'http://localhost:8895','office.internal_url' => 'http://office-documentserver','office.app_internal_url' => 'http://gateway','office.jwt_secret' => 'qa-only']);
        \Illuminate\Support\Facades\Storage::fake('local');
        $disk = \Illuminate\Support\Facades\Storage::disk('local');
        $disk->put('originals/qa.docx', 'fixture');
        $owner = User::factory()->create(['active' => true,'role' => 'employee']);
        $document = Document::create(['owner_id' => $owner->id,'title' => 'QA']);
        $version = DocumentVersion::create(['document_id' => $document->id,'creator_id' => $owner->id,'number' => 1,'storage_key' => 'originals/qa.docx','original_name' => 'qa.docx','mime' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','size' => 7,'sha256' => str_repeat('a', 64),'status' => 'ready']);
        $document->update(['published_version_id' => $version->id]);
        $config = $this->actingAs($owner)->postJson('/api/v1/documents/'.$document->id.'/editor/session')->assertOk()->json('config');
        $old = \Illuminate\Support\Facades\DB::table('office_drafts')->where('document_id', $document->id)->value('storage_key');
        $zipPath = tempnam(sys_get_temp_dir(), 'qa-docx-');
        $zip = new \ZipArchive();
        $zip->open($zipPath, \ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', '<Types/>');
        $zip->addFromString('word/document.xml', '<document/>');
        $zip->close();
        Http::fake(['http://office-documentserver/cache/*' => Http::response(file_get_contents($zipPath), 200)]);
        unlink($zipPath);
        $token = app(\App\Modules\Collaboration\Services\OfficeTokens::class)->sign(['key' => $config['document']['key'],'status' => 2,'url' => 'http://office-documentserver/cache/qa.docx']);
        $this->postJson('/api/v1/office/callback', ['token' => $token])->assertOk()->assertJsonPath('error', 0);
        $this->assertNotSame($old, \Illuminate\Support\Facades\DB::table('office_drafts')->where('document_id', $document->id)->value('storage_key'));
        $disk->assertExists($old);
        $this->assertFalse(\Illuminate\Support\Facades\DB::table('office_drafts')->where('storage_key', $old)->exists());
        $event = \Illuminate\Support\Facades\DB::table('outbox_events')->where('type', 'storage.remove_document_files')->first();
        $this->assertNotNull($event);
        (new \App\Modules\Documents\Jobs\RemoveDocumentFiles(json_decode($event->payload, true)['keys']))->handle();
        $disk->assertMissing($old);
    }
    public function test_google_upload_retries_only_explicit_unauthorized_response(): void
    {
        $bodies = [];
        Http::fake(function ($request) use (&$bodies) {
            $bodies[] = $request->body();
            return count($bodies) === 1 ? Http::response('', 401) : Http::response(['id' => 'saved'], 200);
        });
        $provider = new GoogleDisk('expired', fn () => 'fresh');
        $path = tempnam(sys_get_temp_dir(), 'qa-export-');
        file_put_contents($path, 'document bytes');
        try {
            $provider->upload('/test.txt', $path);
            Http::assertSentCount(2);
            Http::assertSent(fn ($request) => $request->hasHeader('Authorization', 'Bearer fresh'));
            $this->assertStringContainsString('document bytes', $bodies[1]);
        } finally {
            unlink($path);
        }
    }

    public function test_account_quota_rejects_upload_without_leaving_files_or_document(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        config(['documents.max_account_bytes' => 2]);
        $owner = User::factory()->create(['role' => 'employee', 'active' => true]);
        $this->actingAs($owner)->withHeader('Idempotency-Key', 'quota-test-key')->post('/api/v1/documents', [
            'file' => \Illuminate\Http\UploadedFile::fake()->createWithContent('test.txt', 'valid text'),
        ], ['Accept' => 'application/json'])->assertStatus(413);
        $this->assertDatabaseCount('documents', 0);
        $this->assertSame([], \Illuminate\Support\Facades\Storage::disk('local')->allFiles());
    }
    public function test_cleanup_removes_only_old_unreferenced_office_files(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        $disk = \Illuminate\Support\Facades\Storage::disk('local');
        $disk->put('office-drafts/old.docx', 'old');
        $disk->put('office-drafts/recent.docx', 'recent');
        touch($disk->path('office-drafts/old.docx'), now()->subDays(2)->timestamp);
        $cleanup = app(\App\Modules\Collaboration\Services\OfficeDraftCleanup::class);
        $this->assertSame(1, $cleanup->handle());
        $disk->assertExists('office-drafts/old.docx');
        $this->assertSame(1, $cleanup->handle(true));
        $disk->assertMissing('office-drafts/old.docx');
        $disk->assertExists('office-drafts/recent.docx');
    }
}
