<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Services\UploadDocument;
use App\Modules\Identity\Notifications\VerifyEmail;
use App\Modules\Integrations\Jobs\ProcessTransfer;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Services\ProviderFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_visitor_registers_as_an_unverified_employee_and_receives_a_verification_email(): void
    {
        Notification::fake();

        $registration = $this->postJson('/api/v1/auth/register', [
            'name' => 'Новый сотрудник',
            'email' => 'Visitor@Example.test',
            'password' => 'A-secure-password-2026!',
            'password_confirmation' => 'A-secure-password-2026!',
            'active' => false,
            'email_verified_at' => '2026-01-01T00:00:00Z',
        ])->assertCreated()
            ->assertJsonStructure(['data' => ['email_verified_at']])
            ->assertJsonPath('data.name', 'Новый сотрудник')
            ->assertJsonPath('data.email', 'visitor@example.test')
            ->assertJsonPath('data.role', 'employee')
            ->assertJsonPath('data.active', true)
            ->assertJsonPath('data.email_verified_at', null)
            ->assertJsonMissingPath('data.password');

        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.id', $registration->json('data.id'));
        Notification::assertSentTo(User::findOrFail($registration->json('data.id')), VerifyEmail::class);
    }

    public function test_registration_rejects_an_existing_email_regardless_of_case_without_authenticating_the_visitor(): void
    {
        $account = User::factory()->create(['email' => 'existing@example.test']);
        Notification::fake();

        $this->postJson('/api/v1/auth/register', [
            'name' => 'Duplicate account',
            'email' => 'EXISTING@EXAMPLE.TEST',
            'password' => 'A-secure-password-2026!',
            'password_confirmation' => 'A-secure-password-2026!',
        ])->assertUnprocessable()->assertJsonPath('error.details.email.0', 'Этот email уже используется.');

        $this->getJson('/api/v1/me')->assertUnauthorized();
        Notification::assertNothingSent();
        $this->actingAs($account)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.name', $account->name);
    }

    public function test_the_email_link_verifies_the_signed_in_account_and_repeating_it_preserves_the_confirmation(): void
    {
        $account = User::factory()->unverified()->create();
        $url = (new VerifyEmail)->toMail($account)->actionUrl;

        $verified = $this->actingAs($account)->getJson($url)->assertOk()->assertJsonPath('data.id', $account->id)->json('data.email_verified_at');
        $this->assertNotNull($verified);

        $this->travel(1)->minutes();
        $this->actingAs($account->fresh())->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email_verified_at', $verified);
        $this->getJson($url)->assertOk()->assertJsonPath('data.email_verified_at', $verified);
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email_verified_at', $verified);
    }

    public function test_an_unverified_employee_can_log_in_and_request_another_verification_email(): void
    {
        $account = User::factory()->unverified()->create();
        Notification::fake();

        $this->postJson('/api/v1/auth/login', ['email' => $account->email, 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.email_verified_at', null);
        $this->postJson('/api/v1/auth/verification-notification')->assertAccepted();
        Notification::assertSentTo($account, VerifyEmail::class);
    }

    #[DataProvider('writingRoles')]
    public function test_an_unverified_owner_can_read_but_cannot_upload_edit_or_comment(string $role): void
    {
        Storage::fake('local');
        $account = User::factory()->unverified()->create(['role' => $role]);
        $document = Document::create(['owner_id' => $account->id, 'title' => 'Original title']);
        $version = DocumentVersion::create(['document_id' => $document->id, 'creator_id' => $account->id, 'number' => 1, 'storage_key' => 'original.txt', 'original_name' => 'original.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text'), 'status' => 'ready']);
        $document->update(['published_version_id' => $version->id, 'desired_version_id' => $version->id]);

        $this->actingAs($account)->getJson('/api/v1/documents/'.$document->id)
            ->assertOk()->assertJsonPath('data.permissions.read', true)
            ->assertJsonPath('data.permissions.edit', false)->assertJsonPath('data.permissions.comment', false);
        $this->postJson('/api/v1/documents', ['file' => UploadedFile::fake()->createWithContent('new.txt', 'new text')], ['Idempotency-Key' => 'unverified-upload-123'])->assertForbidden();
        $this->patchJson('/api/v1/documents/'.$document->id, ['title' => 'Changed title', 'revision' => 1])->assertForbidden();
        $this->postJson('/api/v1/documents/'.$document->id.'/comments', ['body' => 'Blocked comment', 'version_id' => $version->id])->assertForbidden();
        $this->getJson('/api/v1/documents/'.$document->id)->assertOk()->assertJsonPath('data.title', 'Original title');
        $this->getJson('/api/v1/documents')->assertOk()->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/documents/'.$document->id.'/comments')->assertOk()->assertJsonPath('data', []);
    }

    public static function writingRoles(): array
    {
        return [['employee'], ['admin']];
    }

    public function test_an_unverified_account_cannot_use_cloud_import_to_bypass_the_upload_restriction(): void
    {
        $account = User::factory()->unverified()->create();
        $connection = CloudConnection::create(['owner_id' => $account->id, 'provider' => 'yandex', 'name' => 'Personal disk', 'credentials' => ['token' => 'test-only-token']]);

        $this->actingAs($account)->postJson('/api/v1/transfers', [
            'connection_id' => $connection->id,
            'direction' => 'import',
            'path' => '/sample.txt',
            'filename' => 'sample.txt',
        ], ['Idempotency-Key' => 'unverified-import-123'])->assertForbidden();
        $this->getJson('/api/v1/transfers')->assertOk()->assertJsonPath('data', []);
    }

    public function test_a_queued_import_rechecks_email_verification_before_contacting_the_cloud_provider(): void
    {
        Http::preventStrayRequests();
        $account = User::factory()->unverified()->create();
        $connection = CloudConnection::create(['owner_id' => $account->id, 'provider' => 'yandex', 'name' => 'Personal disk', 'credentials' => ['token' => 'test-only-token']]);
        $transfer = CloudTransfer::create(['initiator_id' => $account->id, 'connection_id' => $connection->id, 'direction' => 'import', 'remote_path' => '/sample.txt', 'filename' => 'sample.txt']);

        (new ProcessTransfer($transfer->id))->handle(new ProviderFactory, new UploadDocument);

        $this->actingAs($account)->getJson('/api/v1/transfers')->assertOk()
            ->assertJsonPath('data.0.status', 'failed')->assertJsonPath('data.0.error_code', 'ACCESS_REVOKED');
        Http::assertNothingSent();
    }

    public function test_registration_cannot_choose_an_administrative_role(): void
    {
        Notification::fake();
        $this->postJson('/api/v1/auth/register', [
            'name' => 'Visitor', 'email' => 'visitor@example.test',
            'password' => 'A-secure-password-2026!', 'password_confirmation' => 'A-secure-password-2026!',
            'role' => 'admin',
        ])->assertUnprocessable()->assertJsonPath('error.details.role.0', 'Самостоятельная регистрация создаёт только сотрудника.');
        $this->getJson('/api/v1/me')->assertUnauthorized();
        Notification::assertNothingSent();
    }

    public function test_a_signed_link_cannot_confirm_another_account_or_survive_tampering_and_expiry(): void
    {
        $account = User::factory()->unverified()->create();
        $other = User::factory()->unverified()->create();
        $url = (new VerifyEmail)->toMail($account)->actionUrl;
        $this->actingAs($other)->getJson($url)->assertForbidden();
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email_verified_at', null);

        $tampered = str_replace(sha1($account->email), str_repeat('0', 40), $url);
        $this->actingAs($account)->getJson($tampered)->assertForbidden();
        $this->travel(61)->minutes();
        $this->getJson($url)->assertForbidden()->assertJsonPath('error.message', 'Ссылка подтверждения недействительна или срок её действия истёк. Запросите новое письмо в приложении.');
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email_verified_at', null);
    }

    public function test_verified_and_blocked_accounts_cannot_request_verification_mail(): void
    {
        $verified = User::factory()->create();
        $blocked = User::factory()->unverified()->create(['active' => false]);
        Notification::fake();
        $this->actingAs($verified)->postJson('/api/v1/auth/verification-notification')->assertOk();
        $this->actingAs($blocked)->postJson('/api/v1/auth/verification-notification')->assertUnauthorized();
        Notification::assertNothingSent();
    }

    public function test_registration_attempts_are_rate_limited_before_creating_an_account(): void
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/auth/register', [])->assertUnprocessable();
        }
        $this->postJson('/api/v1/auth/register', [])->assertStatus(429)->assertHeader('Retry-After');
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_verification_resends_are_limited_per_account_and_can_be_retried_later(): void
    {
        $account = User::factory()->unverified()->create();
        Notification::fake();
        $this->actingAs($account);
        for ($attempt = 0; $attempt < 6; $attempt++) {
            $this->postJson('/api/v1/auth/verification-notification')->assertAccepted();
        }
        $this->postJson('/api/v1/auth/verification-notification')->assertStatus(429)->assertHeader('Retry-After');
        Notification::assertSentToTimes($account, VerifyEmail::class, 6);

        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/verification-notification')->assertAccepted();
        Notification::assertSentToTimes($account, VerifyEmail::class, 7);
    }
}
