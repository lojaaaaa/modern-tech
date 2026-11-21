<?php

declare(strict_types=1);

namespace Tests\Postgres;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class DocumentsSearchTest extends TestCase
{
    use RefreshDatabase;

    public function createApplication(): Application
    {
        $app = parent::createApplication();
        $port = filter_var(env('POSTGRES_TEST_PORT'), FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 65535],
        ]);

        if (! $app->environment('testing') || $port === false) {
            throw new RuntimeException('Set POSTGRES_TEST_PORT to the port of the isolated PostgreSQL test database.');
        }

        config([
            'database.default' => 'pgsql',
            'database.connections.pgsql' => [
                'driver' => 'pgsql',
                'host' => '127.0.0.1',
                'port' => $port,
                'database' => 'modern_tech_postgres_test',
                'username' => 'modern_tech_test',
                'password' => 'modern-tech-test-only',
                'charset' => 'utf8',
                'prefix' => '',
                'search_path' => 'public',
            ],
        ]);

        return $app;
    }

    public function test_visibility_and_published_version_filters_apply_before_pagination(): void
    {
        $actor = User::factory()->create();
        $owner = User::factory()->create();
        $shared = $this->publish($owner, 'Common visible', 'public.PDF');
        $shared->grants()->create(['user_id' => $actor->id, 'read' => true]);

        $publishedId = $shared->published_version_id;
        $candidate = $this->createVersion($shared, $owner, 'candidate.docx', number: 2, status: 'failed');
        $shared->update(['desired_version_id' => $candidate->id]);
        DB::table('text_segments')->insert([
            'version_id' => $candidate->id,
            'ordinal' => 0,
            'content' => 'Confidential forecast',
        ]);

        Document::query()->create(['owner_id' => $actor->id, 'title' => 'Common unpublished']);
        $this->publish($owner, 'Common private', 'private.pdf', 'Common private content');

        $this->actingAs($actor)->getJson('/api/v1/search?q=common&format=pdf&status=ready&per_page=1')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $shared->id)
            ->assertJsonPath('data.0.snippet', null)
            ->assertJsonPath('data.0.version.id', $publishedId)
            ->assertJsonPath('data.0.processing_status', 'ready');
        $this->getJson('/api/v1/search?q=Common&format=docx')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/search?q=Common&status=failed')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/search?q=forecast')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/documents?format=docx&status=failed&sort=format')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $shared->id)
            ->assertJsonPath('data.0.processing_status', 'failed');
        $this->getJson('/api/v1/search?q=Common&per_page=1&page=2')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('data', []);
    }

    public function test_postgres_matches_literal_titles_and_ranks_results_from_both_dictionaries(): void
    {
        $owner = User::factory()->create();
        $titleMatch = $this->publish($owner, 'Архив %_\\ отчётов', 'archive.txt');
        $this->publish($owner, 'Архив в отчётах', 'other.txt');
        $titleMatchEnglish = $this->publish($owner, 'Running schedule', 'schedule.txt');
        $english = $this->publish($owner, 'Notes', 'notes.txt', 'The runners were running through the forest.');
        $russian = $this->publish($owner, 'Инструкция', 'document.txt', 'Настройка поиска документов в системе.');

        $this->actingAs($owner)->getJson('/api/v1/documents?' . http_build_query(['q' => 'АРХИВ %_\\']))
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $titleMatch->id);
        $this->getJson('/api/v1/search?q=running')
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.id', $titleMatchEnglish->id)
            ->assertJsonPath('data.1.id', $english->id)
            ->assertJsonPath('data.1.snippet', 'The runners were running through the forest.');
        $this->getJson('/api/v1/search?' . http_build_query(['q' => 'документ']))
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $russian->id)
            ->assertJsonPath('data.0.snippet', 'Настройка поиска документов в системе.');
    }

    public function test_format_sort_uses_the_case_insensitive_extension_and_laravel_pagination(): void
    {
        $owner = User::factory()->create();
        $csv = $this->publish($owner, 'Table', 'export.batch.CSV');
        $this->publish($owner, 'Text', 'file.txt');

        $this->actingAs($owner)->getJson('/api/v1/documents?sort=format&direction=asc&per_page=1')
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.per_page', 1)
            ->assertJsonPath('data.0.id', $csv->id);
    }

    private function publish(User $owner, string $title, string $file, ?string $content = null): Document
    {
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => $title]);
        $version = $this->createVersion($document, $owner, $file);

        $document->update(['published_version_id' => $version->id, 'desired_version_id' => $version->id]);

        if ($content !== null) {
            DB::table('text_segments')->insert([
                'version_id' => $version->id,
                'ordinal' => 0,
                'content' => $content,
            ]);
        }

        return $document;
    }

    private function createVersion(
        Document $document,
        User $owner,
        string $file,
        int $number = 1,
        string $status = 'ready',
    ): DocumentVersion {
        return $document->versions()->create([
            'creator_id' => $owner->id,
            'number' => $number,
            'storage_key' => $file,
            'original_name' => $file,
            'mime' => 'text/plain',
            'size' => 50,
            'sha256' => hash('sha256', $file),
            'status' => $status,
        ]);
    }
}
