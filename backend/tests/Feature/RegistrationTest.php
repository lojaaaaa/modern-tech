<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_visitor_registers_as_an_employee_without_receiving_email(): void
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
            ->assertJsonPath('data.name', 'Новый сотрудник')
            ->assertJsonPath('data.email', 'visitor@example.test')
            ->assertJsonPath('data.role', 'employee')
            ->assertJsonPath('data.active', true)
            ->assertJsonMissingPath('data.email_verified_at')
            ->assertJsonMissingPath('data.password');

        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.id', $registration->json('data.id'));
        Notification::assertNothingSent();
    }

    public function test_registration_rejects_an_existing_email_regardless_of_case_without_authenticating_the_visitor(): void
    {
        $this->app->setLocale('ru');
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

    #[DataProvider('writingRoles')]
    public function test_an_owner_can_upload_edit_and_comment_without_email_verification(string $role): void
    {
        Storage::fake('local');
        $account = User::factory()->create(['role' => $role]);
        $document = Document::query()->create(['owner_id' => $account->id, 'title' => 'Original title']);
        $version = DocumentVersion::query()->create(['document_id' => $document->id, 'creator_id' => $account->id, 'number' => 1, 'storage_key' => 'original.txt', 'original_name' => 'original.txt', 'mime' => 'text/plain', 'size' => 4, 'sha256' => hash('sha256', 'text'), 'status' => 'ready']);
        $document->update(['published_version_id' => $version->id, 'desired_version_id' => $version->id]);

        $this->actingAs($account)->getJson('/api/v1/documents/'.$document->id)
            ->assertOk()->assertJsonPath('data.permissions.read', true)
            ->assertJsonPath('data.permissions.edit', true)->assertJsonPath('data.permissions.comment', true);
        $file = fn () => UploadedFile::fake()->createWithContent('new.txt', 'new text');
        $this->post('/api/v1/documents', ['file' => $file()], ['Idempotency-Key' => 'unverified-upload-123'])
            ->assertAccepted();
        $this->postJson('/api/v1/documents/duplicates', ['file' => $file()])->assertOk();
        $this->patchJson('/api/v1/documents/'.$document->id, ['title' => 'Changed title', 'revision' => 1])->assertOk();
        $this->postJson('/api/v1/documents/'.$document->id.'/comments', ['body' => 'New comment', 'version_id' => $version->id])->assertCreated();
        $this->postJson('/api/v1/documents/'.$document->id.'/versions', ['file' => $file()], ['Idempotency-Key' => 'unverified-version-123'])
            ->assertAccepted();
        $this->getJson('/api/v1/documents/'.$document->id)->assertOk()->assertJsonPath('data.title', 'Changed title');
        $this->getJson('/api/v1/documents')->assertOk()->assertJsonPath('meta.total', 2);
        $this->getJson('/api/v1/documents/'.$document->id.'/comments')->assertOk()->assertJsonCount(1, 'data');
    }

    public static function writingRoles(): array
    {
        return [['employee'], ['admin']];
    }

    public function test_an_employee_can_queue_a_cloud_import_without_email_verification(): void
    {
        $account = User::factory()->create();
        $connection = CloudConnection::query()->create(['owner_id' => $account->id, 'provider' => 'mail', 'name' => 'Personal disk', 'credentials' => ['token' => 'test-only-token']]);

        $this->actingAs($account)->postJson('/api/v1/transfers', [
            'connection_id' => $connection->id,
            'direction' => 'import',
            'path' => '/sample.txt',
            'filename' => 'sample.txt',
        ], ['Idempotency-Key' => 'unverified-import-123'])->assertAccepted();
        $this->getJson('/api/v1/transfers')->assertOk()->assertJsonCount(1, 'data');
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

    public function test_registration_attempts_are_rate_limited_before_creating_an_account(): void
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/auth/register', [])->assertUnprocessable();
        }
        $this->postJson('/api/v1/auth/register', [])->assertStatus(429)->assertHeader('Retry-After');
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }
}
