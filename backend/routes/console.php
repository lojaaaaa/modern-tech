<?php

declare(strict_types=1);
use App\Models\User;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Integrations\Jobs\ProcessTransfer;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Processing\Jobs\ProcessVersion;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
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
    if (User::where('email', $email)->exists()) {
        $this->error('Пользователь уже существует.');

        return;
    }
    $password = $this->secret('Пароль (не менее 12 символов)');
    if (! is_string($password) || strlen($password) < 12) {
        $this->error('Пароль слишком короткий.');

        return;
    }
    User::create(['name' => $this->option('name'), 'email' => $email, 'password' => $password, 'role' => 'admin', 'active' => true]);
    $this->info('Администратор создан.');
})->purpose('Create the first administrator without default passwords');

Artisan::command('processing:reconcile', function (): void {
    $versions = DocumentVersion::whereHas('document')->whereIn('status', ['quarantined', 'scanning', 'extracting'])->where('updated_at', '<', now()->subMinutes(20))->limit(100)->get();
    foreach ($versions as $version) {
        $lock = Cache::lock('process-version:'.$version->id, 960);
        if (! $lock->get()) {
            continue;
        }
        try {
            if ($version->processing_attempts >= 5) {
                $version->update(['status' => 'failed', 'error_code' => 'ATTEMPTS_EXHAUSTED']);

                continue;
            }
            $version->update(['status' => 'quarantined']);
            ProcessVersion::dispatch($version->id);
        } finally {
            $lock->release();
        }
    }
    // Remote writes are never replayed when their outcome cannot be determined.
    CloudTransfer::where('status', 'running')->where('updated_at', '<', now()->subMinutes(20))->update(['status' => 'failed', 'error_code' => 'OUTCOME_UNKNOWN']);
})->purpose('Recover interrupted local processing without replaying remote writes');
Schedule::command('processing:reconcile')->everyFiveMinutes()->withoutOverlapping();
