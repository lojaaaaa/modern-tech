<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Documents\Jobs\RemoveDocumentFiles;
use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Enums\CloudTransferStatus;
use App\Modules\Integrations\Jobs\ProcessTransfer;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Processing\Jobs\ProcessVersion;
use App\Modules\Processing\VersionProcessing;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('outbox:dispatch', function (): void {
    DB::transaction(function (): void {
        $events = DB::table('outbox_events')->whereNull('dispatched_at')->orderBy('created_at')->lockForUpdate()->limit(100)->get();
        foreach ($events as $event) {
            $payload = json_decode($event->payload, true, 512, JSON_THROW_ON_ERROR);
            if ($event->type === 'process.version') {
                ProcessVersion::dispatch($payload['version_id']);
            } elseif ($event->type === 'process.transfer') {
                ProcessTransfer::dispatch($payload['transfer_id']);
            } elseif ($event->type === 'storage.remove_document_files') {
                RemoveDocumentFiles::dispatch($payload['keys']);
            } else {
                continue;
            }
            DB::table('outbox_events')->where('id', $event->id)->update(['dispatched_at' => now(), 'updated_at' => now()]);
        }
    });
})->purpose('Deliver pending transactional outbox records');
Schedule::command('outbox:dispatch')->everyTenSeconds()->withoutOverlapping();
Artisan::command('app:create-admin {email} {--name=Администратор}', function (): void {
    $email = mb_strtolower($this->argument('email'));
    if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $this->error('Некорректный email.');

        return;
    }
    if (User::query()->where('email', $email)->exists()) {
        $this->error('Пользователь уже существует.');

        return;
    }
    $password = $this->secret('Пароль (не менее 12 символов)');
    if (! is_string($password) || strlen($password) < 12) {
        $this->error('Пароль слишком короткий.');

        return;
    }
    User::query()->create([
        'name' => $this->option('name'),
        'email' => $email,
        'password' => $password,
        'role' => UserRole::ADMIN,
        'active' => true,
    ]);
    $this->info('Администратор создан.');
})->purpose('Create the first administrator without default passwords');

Artisan::command('processing:reconcile', function (VersionProcessing $processing): void {
    foreach ($processing->recoverInterrupted() as $versionId) {
        ProcessVersion::dispatch($versionId);
    }
    // Remote writes are never replayed when their outcome cannot be determined.
    CloudTransfer::query()
        ->where('status', CloudTransferStatus::RUNNING)
        ->where('updated_at', '<', now()->subMinutes(20))
        ->update(['status' => CloudTransferStatus::FAILED, 'error_code' => 'OUTCOME_UNKNOWN']);
})->purpose('Recover interrupted local processing without replaying remote writes');
Schedule::command('processing:reconcile')->everyFiveMinutes()->withoutOverlapping();
