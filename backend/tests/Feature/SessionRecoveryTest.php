<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Identity\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class SessionRecoveryTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_normalizes_the_email_and_authenticated_json_is_not_cached(): void
    {
        $user = User::factory()->unverified()->create(['email' => 'session@example.test']);
        $this->postJson('/api/v1/auth/login', ['email' => ' SESSION@EXAMPLE.TEST ', 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.id', $user->id)->assertHeader('Cache-Control', 'no-store, private');
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email_verified_at', null)->assertHeader('Cache-Control', 'no-store, private');
    }

    public function test_login_limits_failed_attempts_with_a_uniform_error_and_retry_header(): void
    {
        $user = User::factory()->create(['active' => false]);
        $request = ['email' => $user->email, 'password' => 'wrong-password'];
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/auth/login', $request)->assertUnprocessable()
                ->assertJsonPath('error.details.email.0', 'Неверный email или пароль.');
        }
        $this->postJson('/api/v1/auth/login', $request)->assertStatus(429)->assertHeader('Retry-After');
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_a_mail_derived_reset_changes_the_password_and_the_token_cannot_be_used_twice(): void
    {
        $user = User::factory()->create(['email' => 'recover@example.test']);
        Notification::fake();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'RECOVER@EXAMPLE.TEST'])->assertOk();
        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $notification) use (&$token): bool {
            $token = $notification->token;

            return true;
        });
        $payload = ['email' => 'RECOVER@EXAMPLE.TEST', 'token' => $token, 'password' => 'A-recovered-password-2026!', 'password_confirmation' => 'A-recovered-password-2026!'];
        $this->postJson('/api/v1/auth/reset-password', $payload)->assertOk();
        $this->postJson('/api/v1/auth/reset-password', $payload)->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => $payload['password']])->assertOk()->assertJsonPath('data.id', $user->id);
    }

    public function test_a_password_change_invalidates_a_previously_authenticated_session(): void
    {
        $user = User::factory()->create();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
        $this->getJson('/api/v1/me')->assertOk();
        $user->forceFill(['password' => 'A-new-password-2026!'])->save();
        auth()->forgetGuards();

        $this->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_forgot_password_does_not_disclose_missing_or_blocked_accounts(): void
    {
        $active = User::factory()->create();
        $blocked = User::factory()->create(['active' => false]);
        Notification::fake();
        $responses = [];
        foreach ([$active->email, $blocked->email, 'missing@example.test'] as $email) {
            $responses[] = $this->postJson('/api/v1/auth/forgot-password', ['email' => $email])->assertOk()->json('data');
        }
        $this->assertSame($responses[0], $responses[1]);
        $this->assertSame($responses[0], $responses[2]);
        Notification::assertSentTo($active, ResetPassword::class);
        Notification::assertNotSentTo($blocked, ResetPassword::class);
    }

    public function test_an_expired_password_link_is_rejected_and_the_existing_password_still_works(): void
    {
        $user = User::factory()->create();
        Notification::fake();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertOk();
        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $notification) use (&$token): bool {
            $token = $notification->token;

            return true;
        });
        $this->travel(61)->minutes();
        $this->postJson('/api/v1/auth/reset-password', ['email' => $user->email, 'token' => $token, 'password' => 'A-recovered-password-2026!', 'password_confirmation' => 'A-recovered-password-2026!'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
    }
}
