<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class ObservabilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_metrics_are_admin_only_and_request_id_is_present(): void
    {
        $employee = User::factory()->create(['role' => 'employee']);
        $this->actingAs($employee)->getJson('/api/v1/admin/metrics')->assertForbidden()->assertHeader('X-Request-ID');
        $admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($admin)->get('/api/v1/admin/metrics')->assertOk()->assertSee('outbox_pending 0');
    }
}
