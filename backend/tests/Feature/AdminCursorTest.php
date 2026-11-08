<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
            DB::table('audit_events')->insert(['id' => (string) Str::uuid(), 'actor_id' => $admin->id, 'action' => $i < 5 ? 'document.updated' : 'user.updated', 'resource_id' => null, 'metadata' => '{}', 'created_at' => '2026-11-08 12:00:00']);
        }
        $url = '/api/v1/admin/audit?per_page=2&action=document.updated&q=Audit&date_from=2026-11-08&date_to=2026-11-08';
        $first = $this->actingAs($admin)->getJson($url)->assertOk()->assertJsonCount(2, 'data')->json();
        $second = $this->getJson($url.'&cursor='.urlencode($first['meta']['next_cursor']))->assertOk()->assertJsonCount(2, 'data')->json();
        $this->assertEmpty(array_intersect(array_column($first['data'], 'id'), array_column($second['data'], 'id')));
        $this->assertNull($second['meta']['next_cursor']);
        $this->getJson('/api/v1/admin/audit?cursor=broken')->assertUnprocessable();
        $this->getJson('/api/v1/admin/audit?sort=actor_name')->assertUnprocessable();
        $this->getJson('/api/v1/admin/audit?date_from=2026-11-09&date_to=2026-11-08')->assertUnprocessable();
        $this->getJson('/api/v1/admin/audit?date_to=2026-11-07')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs(User::factory()->create(['role' => 'employee']))->getJson($url)->assertForbidden();
    }
}
