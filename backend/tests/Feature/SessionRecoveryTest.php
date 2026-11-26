<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Identity\Notifications\ResetPassword;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Session;
use Tests\TestCase;

class SessionRecoveryTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_normalizes_the_email_and_authenticated_json_is_not_cached(): void
    {
        $user = User::factory()->create(['email' => 'session@example.test']);
        $this->postJson('/api/v1/auth/login', ['email' => ' SESSION@EXAMPLE.TEST ', 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.id', $user->id)->assertHeader('Cache-Control', 'no-store, private');
        $this->getJson('/api/v1/me')->assertOk()->assertJsonMissingPath('data.email_verified_at')->assertHeader('Cache-Control', 'no-store, private');
    }

    public function test_login_limits_failed_attempts_with_a_uniform_error_and_retry_header(): void
    {
        $user = User::factory()->create(['active' => false]);
        $request = ['email' => $user->email, 'password' => 'wrong-password'];
        $this->postJson('/api/v1/auth/login', ['email' => $user->email])->assertUnprocessable()
            ->assertJsonStructure(['error' => ['details' => ['password']]]);
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/auth/login', $request)->assertUnprocessable()
                ->assertJsonPath('error.details.email.0', 'Неверный email или пароль.');
        }
        $this->postJson('/api/v1/auth/login', array_replace($request, ['email' => ' '.strtoupper($user->email).' ']))
            ->assertTooManyRequests()->assertHeader('Retry-After')
            ->assertJsonPath('error.message', 'Слишком много попыток. Попробуйте через минуту.');
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_successful_login_clears_failed_attempts(): void
    {
        $user = User::factory()->create();
        $wrongCredentials = ['email' => $user->email, 'password' => 'wrong-password'];
        $this->postJson('/api/v1/auth/login', $wrongCredentials)
            ->assertUnprocessable()->assertHeader('X-RateLimit-Remaining', '4');
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
        $this->postJson('/api/v1/auth/login', $wrongCredentials)
            ->assertUnprocessable()->assertHeader('X-RateLimit-Remaining', '4');
    }

    public function test_guest_password_and_oauth_routes_have_separate_rate_limits(): void
    {
        $this->get('/api/v1/connections/google/callback')->assertRedirect();
        $this->postJson('/api/v1/auth/reset-password')->assertUnprocessable();

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $this->postJson('/api/v1/auth/forgot-password')->assertUnprocessable();
        }
        $this->postJson('/api/v1/auth/forgot-password')->assertTooManyRequests()->assertHeader('Retry-After');

        $this->postJson('/api/v1/auth/reset-password')->assertUnprocessable()->assertHeader('X-RateLimit-Remaining', '8');
        $this->get('/api/v1/connections/google/callback')->assertRedirect()->assertHeader('X-RateLimit-Remaining', '58');
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
        Event::fake([PasswordReset::class]);
        $this->postJson('/api/v1/auth/reset-password', $payload)->assertOk();
        Event::assertDispatched(PasswordReset::class, fn (PasswordReset $event) => $event->user->id === $user->id);
        $this->postJson('/api/v1/auth/reset-password', $payload)->assertUnprocessable();
        Event::assertDispatchedTimes(PasswordReset::class, 1);
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

    public function test_a_password_reset_revokes_only_the_account_sessions(): void
    {
        config(['session.driver' => 'database', 'session.lottery' => [0, 100]]);
        Session::forgetDrivers();
        $user = User::factory()->create();
        $other = User::factory()->create();
        $token = Password::createToken($user);
        $ids = [str_repeat('a', 40), str_repeat('b', 40), str_repeat('c', 40)];
        DB::table('sessions')->insert([
            ['id' => $ids[0], 'user_id' => $user->id, 'payload' => base64_encode('{}'), 'last_activity' => time()],
            ['id' => $ids[1], 'user_id' => $user->id, 'payload' => base64_encode('{}'), 'last_activity' => time()],
            ['id' => $ids[2], 'user_id' => $other->id, 'payload' => base64_encode('{}'), 'last_activity' => time()],
        ]);

        $this->postJson('/api/v1/auth/reset-password', [
            'email' => $user->email,
            'token' => $token,
            'password' => 'A-new-password-2026!',
            'password_confirmation' => 'A-new-password-2026!',
        ])->assertOk();

        $this->assertDatabaseMissing('sessions', ['id' => $ids[0]]);
        $this->assertDatabaseMissing('sessions', ['id' => $ids[1]]);
        $this->assertDatabaseHas('sessions', ['id' => $ids[2]]);
    }

    public function test_a_previously_issued_reset_token_cannot_change_a_blocked_account(): void
    {
        $user = User::factory()->create();
        $token = Password::createToken($user);
        $user->update(['active' => false]);
        Event::fake([PasswordReset::class]);

        $this->postJson('/api/v1/auth/reset-password', [
            'email' => $user->email,
            'token' => $token,
            'password' => 'A-new-password-2026!',
            'password_confirmation' => 'A-new-password-2026!',
        ])->assertUnprocessable();

        $this->assertTrue(Hash::check('password', $user->fresh()->password));
        $this->assertDatabaseCount('audit_events', 0);
        Event::assertNotDispatched(PasswordReset::class);
    }
}
