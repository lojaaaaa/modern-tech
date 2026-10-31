<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Jobs\ProcessVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class ReconciliationTest extends TestCase
{
    use RefreshDatabase;

    public function test_stale_local_processing_is_requeued_but_attempt_limit_is_terminal(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $doc = Document::create(['owner_id' => $user->id, 'title' => 'test']);
        $attributes = ['document_id' => $doc->id, 'creator_id' => $user->id, 'storage_key' => 'test', 'original_name' => 'test.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'test'), 'status' => 'extracting', 'updated_at' => now()->subHour()];
        $retry = DocumentVersion::create($attributes + ['number' => 1, 'processing_attempts' => 1]);
        $exhausted = DocumentVersion::create($attributes + ['number' => 2, 'processing_attempts' => 5]);
        $this->artisan('processing:reconcile')->assertSuccessful();
        Queue::assertPushed(ProcessVersion::class, fn ($job) => $job->versionId === $retry->id);
        Queue::assertPushed(ProcessVersion::class, 1);
        $this->assertSame('failed', $exhausted->fresh()->status);
    }
}
