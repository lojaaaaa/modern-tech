<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Identity\Actions\UpdateManagedUserAction;
use App\Modules\Identity\DTO\UpdateManagedUserData;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
use Tests\TestCase;

final class UserAdministrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_list_has_bounded_stable_pages(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->count(22)->create(['name' => 'Same Name']);
        $first = $this->actingAs($admin)->getJson('/api/v1/users?per_page=10')->assertOk()->assertJsonCount(10, 'data')->json();
        $second = $this->getJson('/api/v1/users?per_page=10&cursor='.urlencode($first['next_cursor']))->assertOk()->assertJsonCount(10, 'data')->json();
        $this->assertEmpty(array_intersect(array_column($first['data'], 'id'), array_column($second['data'], 'id')));
        $back = $this->getJson('/api/v1/users?per_page=10&cursor='.urlencode($second['prev_cursor']))->assertOk()->json('data');
        $this->assertSame(array_column($first['data'], 'id'), array_column($back, 'id'));
        $restart = $this->getJson('/api/v1/users?per_page=10&cursor=bad')->assertOk()->json('data');
        $this->assertSame(array_column($first['data'], 'id'), array_column($restart, 'id'));
        $this->getJson('/api/v1/users?q=Same&role=employee&active=1&sort=email&direction=desc')->assertOk()->assertJsonCount(20, 'data');
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

    public function test_invalid_user_requests_are_authorized_before_their_fields_are_validated(): void
    {
        $target = User::factory()->create(['name' => 'Unchanged']);
        foreach (['employee', 'observer'] as $role) {
            $actor = User::factory()->create(['role' => $role]);
            $this->actingAs($actor)->getJson('/api/v1/users?per_page=0&cursor=bad')->assertForbidden()->assertJsonPath('error.code', 'HTTP_403');
            $this->postJson('/api/v1/users', ['email' => $target->email])->assertForbidden()->assertJsonPath('error.code', 'HTTP_403');
            $this->patchJson('/api/v1/users/'.$target->id, ['role' => 'invalid', 'is_active' => 'invalid'])->assertForbidden()->assertJsonPath('error.code', 'HTTP_403');
        }

        $this->assertDatabaseCount('users', 3);
        $this->assertSame('Unchanged', $target->fresh()->name);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_user_search_is_case_insensitive_and_keeps_role_and_active_filters(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $nameMatch = User::factory()->create(['name' => 'MiXeD Name', 'active' => false]);
        $emailMatch = User::factory()->create(['name' => 'Other', 'email' => 'mixed.mail@example.test', 'active' => false]);
        User::factory()->create(['name' => 'Mixed Observer', 'role' => 'observer', 'active' => false]);
        User::factory()->create(['name' => 'Mixed Active', 'active' => true]);

        $response = $this->actingAs($admin)->getJson('/api/v1/users?q=mIxEd&role=employee&active=0&sort=id')->assertOk()->assertJsonCount(2, 'data');
        $this->assertSame([$nameMatch->id, $emailMatch->id], array_column($response->json('data'), 'id'));
    }

    public function test_user_list_accepts_existing_cursors_and_preserves_the_navigation_contract(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        foreach ([1001 => 'Legacy Ada', 1002 => 'Legacy Bea', 1003 => 'Legacy Cia'] as $id => $name) {
            User::factory()->create(['id' => $id, 'name' => $name]);
        }
        // Cursors emitted by the original controller, independent of the new query implementation.
        $afterAda = 'eyJuYW1lIjoiTGVnYWN5IEFkYSIsImlkIjoxMDAxLCJfcG9pbnRzVG9OZXh0SXRlbXMiOnRydWUsIl9zb3J0IjoibmFtZSIsIl9kaXJlY3Rpb24iOiJhc2MifQ';
        $beforeBea = 'eyJuYW1lIjoiTGVnYWN5IEJlYSIsImlkIjoxMDAyLCJfcG9pbnRzVG9OZXh0SXRlbXMiOmZhbHNlLCJfc29ydCI6Im5hbWUiLCJfZGlyZWN0aW9uIjoiYXNjIn0';
        $nativeAfterAda = 'eyJuYW1lIjoiTGVnYWN5IEFkYSIsImlkIjoxMDAxLCJfcG9pbnRzVG9OZXh0SXRlbXMiOnRydWV9';
        $nativeAfterBea = 'eyJuYW1lIjoiTGVnYWN5IEJlYSIsImlkIjoxMDAyLCJfcG9pbnRzVG9OZXh0SXRlbXMiOnRydWV9';
        $nativeBeforeBea = 'eyJuYW1lIjoiTGVnYWN5IEJlYSIsImlkIjoxMDAyLCJfcG9pbnRzVG9OZXh0SXRlbXMiOmZhbHNlfQ';

        $first = $this->actingAs($admin)->getJson('/api/v1/users?q=Legacy&per_page=1')->assertOk()->assertJsonPath('data.0.id', 1001);
        $this->assertSame(['data', 'path', 'per_page', 'next_cursor', 'next_page_url', 'prev_cursor', 'prev_page_url'], array_keys($first->json()));
        $first->assertJsonPath('next_cursor', $nativeAfterAda)->assertJsonPath('prev_cursor', null)->assertJsonPath('per_page', 1);
        $this->assertStringContainsString('q=Legacy', $first->json('next_page_url'));
        $second = $this->getJson('/api/v1/users?q=Legacy&per_page=1&cursor='.$afterAda)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', 1002);
        $second->assertJsonPath('next_cursor', $nativeAfterBea)->assertJsonPath('prev_cursor', $nativeBeforeBea)->assertJsonPath('per_page', 1);
        $this->getJson('/api/v1/users?q=Legacy&per_page=1&cursor='.$beforeBea)->assertOk()->assertJsonPath('data.0.id', 1001);
        $this->getJson('/api/v1/users?q=Legacy&per_page=1&cursor='.$nativeAfterAda)->assertOk()->assertJsonPath('data.0.id', 1002);
        $this->getJson('/api/v1/users?q=Legacy&per_page=1&direction=desc')->assertOk()->assertJsonPath('data.0.id', 1003);
    }

    public function test_user_list_preserves_false_and_null_filters(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $inactive = User::factory()->create(['name' => 'Member A', 'active' => false]);
        User::factory()->create(['name' => 'Member B', 'active' => true]);
        User::factory()->create(['name' => 'Member C', 'active' => false, 'role' => 'observer']);

        $this->actingAs($admin);
        foreach ([false, 0, '0'] as $active) {
            $response = $this->json('GET', '/api/v1/users', ['q' => 'Member', 'role' => 'employee', 'active' => $active, 'per_page' => '1', 'sort' => 'id', 'direction' => 'asc'])
                ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $inactive->id)->assertJsonPath('data.0.active', false);
            $this->assertSame(1, $response->json('per_page'));
        }
        $this->json('GET', '/api/v1/users', ['q' => 'Member', 'role' => 'employee', 'active' => null, 'sort' => null, 'direction' => null])
            ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('per_page', 20);
    }

    public function test_managed_user_inputs_preserve_normalization_and_partial_changes(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $payload = ['name' => 'Managed', 'email' => ' Mixed.Case@Example.TEST ', 'password' => 'long-enough-password', 'role' => 'employee'];
        $created = $this->actingAs($admin)->postJson('/api/v1/users', $payload)->assertCreated()
            ->assertJsonPath('data.email', 'mixed.case@example.test')->assertJsonMissingPath('data.password')->assertJsonMissingPath('data.remember_token');
        $id = $created->json('data.id');
        $this->assertSame(UserRole::EMPLOYEE, User::query()->findOrFail($id)->role);
        $this->assertTrue(Hash::check($payload['password'], User::query()->findOrFail($id)->password));
        $this->postJson('/api/v1/users', $payload)->assertUnprocessable()->assertJsonValidationErrors('email', 'error.details');
        $this->patchJson('/api/v1/users/'.$id, ['is_active' => 'invalid'])->assertUnprocessable()->assertJsonValidationErrors('is_active', 'error.details');
        $this->patchJson('/api/v1/users/'.$id, ['is_active' => '0', 'email' => 'ignored@example.test', 'password' => 'ignored-password'])->assertOk()
            ->assertJsonPath('data.active', false)->assertJsonPath('data.name', 'Managed')->assertJsonPath('data.role', 'employee')->assertJsonPath('data.email', 'mixed.case@example.test')
            ->assertJsonMissingPath('data.password')->assertJsonMissingPath('data.remember_token');

        $this->assertTrue(Hash::check($payload['password'], User::query()->findOrFail($id)->password));
        $this->assertDatabaseCount('users', 2);
        $this->assertDatabaseHas('audit_events', ['actor_id' => $admin->id, 'action' => 'user.created', 'resource_id' => (string) $id]);
        $this->assertDatabaseHas('audit_events', ['actor_id' => $admin->id, 'action' => 'user.updated', 'resource_id' => (string) $id]);
    }

    public function test_role_change_is_authorized_and_observer_cannot_use_an_old_edit_grant(): void
    {
        $this->app->setLocale('ru');
        $admin = User::factory()->create(['role' => 'admin']);
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $document = Document::query()->create(['owner_id' => $owner->id, 'title' => 'Private']);
        $document->grants()->create(['user_id' => $member->id, 'read' => true, 'edit' => true]);

        $this->actingAs($member)->patchJson('/api/v1/users/'.$owner->id, ['role' => 'admin'])->assertForbidden();
        $this->actingAs($admin)->patchJson('/api/v1/users/'.$member->id, ['role' => 'observer'])->assertOk()->assertJsonPath('data.role', 'observer');
        $this->actingAs($member->fresh())->patchJson('/api/v1/documents/'.$document->id, ['title' => 'Changed', 'revision' => 1])->assertForbidden();
        $this->actingAs($admin)->patchJson('/api/v1/users/'.$admin->id, ['role' => 'employee'])->assertConflict();
        $this->patchJson('/api/v1/users/'.$admin->id, ['is_active' => false])->assertConflict()
            ->assertJsonPath('error.message', 'Нельзя отключить последнего администратора.');
        $this->getJson('/api/v1/users')->assertOk()->assertJsonFragment(['id' => $admin->id, 'role' => 'admin']);
    }

    public function test_update_reloads_the_target_and_audits_its_original_values(): void
    {
        $actor = User::factory()->create(['role' => UserRole::ADMIN]);
        $target = User::factory()->create(['name' => 'Stale']);
        User::query()->whereKey($target->id)->update(['name' => 'Current', 'role' => UserRole::OBSERVER, 'active' => false]);

        $updated = $this->app->make(UpdateManagedUserAction::class)->handle($actor, $target, new UpdateManagedUserData(role: UserRole::EMPLOYEE, isActive: true));

        $this->assertSame('Current', $updated->name);
        $this->assertSame(UserRole::EMPLOYEE, $updated->role);
        $this->assertTrue($updated->active);
        $metadata = DB::table('audit_events')->where('resource_id', (string) $target->id)->value('metadata');
        $this->assertSame([
            'old_role' => 'observer', 'new_role' => 'employee',
            'old_active' => false, 'new_active' => true,
        ], json_decode($metadata, true, flags: JSON_THROW_ON_ERROR));
    }

    public function test_deactivation_revokes_only_the_target_sessions_and_failure_keeps_the_admin_session(): void
    {
        config(['session.driver' => 'database', 'session.lottery' => [0, 100]]);
        Session::forgetDrivers();
        $actor = User::factory()->create(['role' => UserRole::ADMIN]);
        $target = User::factory()->create();
        $adminSession = str_repeat('a', 40);
        $targetSession = str_repeat('b', 40);
        $otherTargetSession = str_repeat('c', 40);
        DB::table('sessions')->insert([
            ['id' => $adminSession, 'user_id' => $actor->id, 'payload' => base64_encode('{}'), 'last_activity' => time()],
            ['id' => $targetSession, 'user_id' => $target->id, 'payload' => base64_encode('{}'), 'last_activity' => time()],
            ['id' => $otherTargetSession, 'user_id' => $target->id, 'payload' => base64_encode('{}'), 'last_activity' => time()],
        ]);

        $this->actingAs($actor)->patchJson('/api/v1/users/'.$target->id, ['is_active' => false])->assertOk()->assertJsonPath('data.active', false);
        $this->assertDatabaseMissing('sessions', ['id' => $targetSession]);
        $this->assertDatabaseMissing('sessions', ['id' => $otherTargetSession]);
        $this->assertDatabaseHas('sessions', ['id' => $adminSession]);
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.id', $actor->id);
        $this->patchJson('/api/v1/users/'.$actor->id, ['is_active' => false])->assertConflict();
        $this->assertDatabaseHas('sessions', ['id' => $adminSession]);
        $this->assertDatabaseCount('audit_events', 1);
    }
}
