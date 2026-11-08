<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class UserAdministrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_list_has_bounded_stable_pages(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->count(22)->create(['name' => 'Same Name']);
        $first = $this->actingAs($admin)->getJson('/api/v1/users?per_page=10')->assertOk()->assertJsonCount(10, 'data')->assertJsonPath('meta.total', 23)->json('data');
        $second = $this->getJson('/api/v1/users?per_page=10&page=2')->assertOk()->assertJsonCount(10, 'data')->json('data');
        $this->assertEmpty(array_intersect(array_column($first, 'id'), array_column($second, 'id')));
        $this->getJson('/api/v1/users?per_page=101')->assertUnprocessable();
    }

    public function test_user_administration_is_available_only_to_administrator_role(): void
    {
        $target = User::factory()->create();
        foreach (['admin' => 200, 'employee' => 403, 'observer' => 403] as $role => $expected) {
            $actor = User::factory()->create(['role' => $role]);
            $this->actingAs($actor)->getJson('/api/v1/users')->assertStatus($expected);
            $this->patchJson('/api/v1/users/'.$target->id, ['name' => 'Changed'])->assertStatus($expected);
            $this->postJson('/api/v1/users', [
                'name' => 'New User', 'email' => $role.'@example.test',
                'password' => 'long-enough-password', 'role' => 'employee',
            ])->assertStatus($expected === 200 ? 201 : 403);
        }
    }

    public function test_role_change_is_authorized_and_observer_cannot_use_an_old_edit_grant(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $document = Document::create(['owner_id' => $owner->id, 'title' => 'Private']);
        $document->grants()->create(['user_id' => $member->id, 'read' => true, 'edit' => true]);

        $this->actingAs($member)->patchJson('/api/v1/users/'.$owner->id, ['role' => 'admin'])->assertForbidden();
        $this->actingAs($admin)->patchJson('/api/v1/users/'.$member->id, ['role' => 'observer'])->assertOk()->assertJsonPath('data.role', 'observer');
        $this->actingAs($member->fresh())->patchJson('/api/v1/documents/'.$document->id, ['title' => 'Changed', 'revision' => 1])->assertForbidden();
        $this->actingAs($admin)->patchJson('/api/v1/users/'.$admin->id, ['role' => 'employee'])->assertConflict();
        $this->getJson('/api/v1/users')->assertOk()->assertJsonFragment(['id' => $admin->id, 'role' => 'admin']);
    }
}
