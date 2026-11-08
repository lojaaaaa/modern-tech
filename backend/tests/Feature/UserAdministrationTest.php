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
