<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class CloudCredentialsTest extends TestCase
{
    use RefreshDatabase;

    public function test_application_id_is_not_accepted_as_user_token(): void
    {
        $user = User::factory()->create(['role' => 'employee']);
        $this->actingAs($user)->postJson('/api/v1/connections', ['provider' => 'yandex', 'name' => 'Disk', 'token' => str_repeat('a', 32)])->assertUnprocessable()->assertJsonPath('error.code', 'HTTP_422');
        $this->assertDatabaseCount('cloud_connections', 0);
    }
}
