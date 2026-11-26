<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Tests\TestCase;

final class ApiDocumentationTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_active_administrators_can_view_production_documentation(): void
    {
        $this->app->instance('env', 'production');
        $this->get('/docs/api')->assertForbidden();
        foreach (['employee', 'observer'] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]))->get('/docs/api')->assertForbidden();
        }
        $blocked = User::factory()->create(['role' => 'admin', 'active' => false]);
        $this->assertFalse(Gate::forUser($blocked)->allows('viewApiDocs'));
        $this->actingAs(User::factory()->create(['role' => 'admin']))->get('/docs/api')->assertOk();
    }
}
