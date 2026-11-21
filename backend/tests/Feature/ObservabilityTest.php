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
        $url = '/api/v1/admin/metrics';
        $this->get($url)->assertUnauthorized();

        $employee = User::factory()->create(['role' => 'employee']);
        $this->actingAs($employee)->getJson($url)
            ->assertForbidden()
            ->assertJsonPath('error.message', 'Запрос отклонён.')
            ->assertHeader('X-Request-ID');

        $inactiveAdmin = User::factory()->create(['role' => 'admin', 'active' => false]);
        $this->actingAs($inactiveAdmin)->get($url)->assertUnauthorized();

        $admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($admin)->get($url)
            ->assertOk()
            ->assertHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Request-ID')
            ->assertSee('outbox_pending 0');
    }
}
