<?php

declare(strict_types=1);

namespace Tests\Feature\Actions;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Observability\Actions\CollectMetricsAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class CollectMetricsActionTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_renders_counts_and_skips_invalid_status_labels(): void
    {
        $user = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $user->id, 'title' => 'Sample']);
        $version = [
            'creator_id' => $user->id,
            'storage_key' => 'sample.txt',
            'original_name' => 'sample.txt',
            'mime' => 'text/plain',
            'size' => 6,
            'sha256' => hash('sha256', 'sample'),
        ];
        $document->versions()->createMany([
            $version + ['number' => 1, 'status' => 'ready'],
            $version + ['number' => 2, 'status' => 'ready'],
            $version + ['number' => 3, 'status' => "ready\n"],
        ]);

        $connection = CloudConnection::query()->create([
            'owner_id' => $user->id,
            'provider' => 'mail',
            'name' => 'Test disk',
            'credentials' => ['token' => 'test'],
        ]);
        $transfer = [
            'initiator_id' => $user->id,
            'connection_id' => $connection->id,
            'direction' => 'import',
            'remote_path' => '/sample.txt',
            'filename' => 'sample.txt',
        ];
        CloudTransfer::query()->create($transfer + ['status' => 'queued']);
        DB::table('cloud_transfers')->insert($transfer + ['id' => Str::uuid()->toString(), 'status' => 'invalid-status']);

        $event = ['type' => 'test', 'payload' => '{}'];
        DB::table('outbox_events')->insert([
            $event + ['id' => Str::uuid()->toString(), 'dispatched_at' => null],
            $event + ['id' => Str::uuid()->toString(), 'dispatched_at' => now()],
        ]);
        DB::table('failed_jobs')->insert([
            'uuid' => Str::uuid()->toString(),
            'connection' => 'database',
            'queue' => 'default',
            'payload' => '{}',
            'exception' => 'Test failure',
        ]);

        $metrics = app(CollectMetricsAction::class)->handle();

        self::assertSame(implode("\n", [
            '# HELP document_versions Number of document versions by processing status.',
            '# TYPE document_versions gauge',
            'document_versions{status="ready"} 2',
            '# TYPE outbox_pending gauge',
            'outbox_pending 1',
            '# TYPE queue_failed_jobs gauge',
            'queue_failed_jobs 1',
            '# TYPE transfers_total gauge',
            'transfers_total{status="queued"} 1',
            '',
        ]), $metrics);
    }
}
