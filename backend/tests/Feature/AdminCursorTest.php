<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\Models\Document;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Pagination\Cursor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AdminCursorTest extends TestCase
{
    use RefreshDatabase;

    public function test_audit_filters_and_cursor_boundaries(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'name' => 'Audit Person']);
        foreach (range(1, 5) as $i) {
            DB::table('audit_events')->insert([
                'id' => (string) Str::uuid(),
                'actor_id' => $admin->id,
                'action' => $i < 5 ? 'document.updated' : 'user.updated',
                'resource_id' => null,
                'metadata' => '{}',
                'created_at' => '2026-11-08 12:00:00',
            ]);
        }
        $url = '/api/v1/admin/audit?per_page=2&action=document.updated&q=Audit&date_from=2026-11-08&date_to=2026-11-08';
        $first = $this->actingAs($admin)->getJson($url)
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('per_page', 2)
            ->assertJsonPath('prev_cursor', null)
            ->json();
        $cursorValues = [
            'created_at' => '2026-11-08 12:00:00',
            'id' => $first['data'][1]['id'],
        ];
        $this->assertSame((new Cursor($cursorValues))->encode(), $first['next_cursor']);
        $second = $this->getJson($first['next_page_url'])
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->json();
        $this->assertEmpty(array_intersect(array_column($first['data'], 'id'), array_column($second['data'], 'id')));
        $this->assertNull($second['next_cursor']);
        $this->getJson($second['prev_page_url'])
            ->assertOk()
            ->assertExactJson($first);

        $legacyCursor = (new Cursor([
            ...$cursorValues,
            '_sort' => 'created_at',
            '_direction' => 'desc',
        ]))->encode();
        $this->getJson($url . '&cursor=' . urlencode($legacyCursor))
            ->assertOk()
            ->assertExactJson($second);
        $this->getJson($url . '&cursor=broken')->assertOk()->assertExactJson($first);
        $this->getJson('/api/v1/admin/audit?sort=actor_name')->assertUnprocessable();
        $this->getJson('/api/v1/admin/audit?date_from=2026-11-09&date_to=2026-11-08')->assertUnprocessable();
        $this->getJson('/api/v1/admin/audit?date_to=2026-11-07')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs(User::factory()->create(['role' => 'employee']))
            ->getJson($url . '&per_page=0')
            ->assertForbidden()
            ->assertJsonPath('error.code', 'HTTP_403');
    }

    public function test_audit_combines_resource_search_and_actor_filter(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $actor = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $actor->id, 'title' => 'Quarterly report']);
        $document->delete();
        AuditWriter::record($actor->id, 'document.deleted', $document->id, ['source' => 'library']);
        AuditWriter::record($admin->id, 'document.restored', $document->id);

        $this->actingAs($admin)->getJson('/api/v1/admin/audit?' . http_build_query([
            'q' => '  QUARTERLY  ',
            'actor_id' => $actor->id,
        ]))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.actor_id', $actor->id)
            ->assertJsonPath('data.0.actor_name', $actor->name)
            ->assertJsonPath('data.0.resource_name', $document->title)
            ->assertJsonMissingPath('data.0.metadata');
    }
}
