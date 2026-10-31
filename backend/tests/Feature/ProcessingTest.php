<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Jobs\ProcessVersion;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProcessingTest extends TestCase
{
    use RefreshDatabase;

    public function test_late_old_version_cannot_replace_new_desired_version(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('original.txt', 'text');
        $user = User::factory()->create();
        $doc = Document::create(['owner_id' => $user->id, 'title' => 'Versioned']);
        $attrs = ['document_id' => $doc->id, 'creator_id' => $user->id, 'storage_key' => 'original.txt', 'original_name' => 'original.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text')];
        $old = DocumentVersion::create($attrs + ['number' => 1]);
        $new = DocumentVersion::create($attrs + ['number' => 2]);
        $doc->update(['desired_version_id' => $new->id]);
        $scanner = \Mockery::mock(VirusScanner::class);
        $scanner->shouldReceive('assertClean')->twice();
        $extractor = \Mockery::mock(TextExtractor::class);
        $extractor->shouldReceive('extract')->twice()->andReturn('text');
        (new ProcessVersion($new->id))->handle($scanner, $extractor);
        (new ProcessVersion($old->id))->handle($scanner, $extractor);
        $this->assertSame($new->id, $doc->fresh()->published_version_id);
        (new ProcessVersion($new->id))->handle($scanner, $extractor);
        $this->assertDatabaseCount('document_versions', 2);
    }
}
