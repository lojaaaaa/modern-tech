<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class CloudCredentialsTest extends TestCase
{
    use RefreshDatabase;

    public function test_application_id_is_not_accepted_as_user_token(): void
    {
        $user = User::factory()->create(['role' => 'employee']);
        $this->actingAs($user)->postJson('/api/v1/connections', ['provider' => 'unsupported', 'name' => 'Disk', 'token' => str_repeat('a', 32)])->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['provider']]]);
        $this->assertDatabaseCount('cloud_connections', 0);
    }
    public function test_unsupported_historic_connections_are_hidden_and_cannot_transfer(): void
    {
        $user = User::factory()->create();
        $connection = CloudConnection::query()->create([
            'owner_id' => $user->id, 'provider' => 'retired', 'name' => 'Old disk',
            'credentials' => ['token' => 'old-test-token'],
        ]);
        $this->actingAs($user)->getJson('/api/v1/connections')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/connections/' . $connection->id . '/files')->assertNotFound();
        $this->assertFalse(app(\App\Modules\Integrations\Policies\CloudConnectionPolicy::class)->transfer($user, $connection));
    }
}
