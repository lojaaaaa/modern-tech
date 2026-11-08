<?php

declare(strict_types=1);

namespace App\Modules\Documents\Services;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Services\FileInspector;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class UploadDocument
{
    public function __construct(private readonly FileInspector $inspector) {}

    public function execute(User $user, IncomingFile $incoming, ?string $title, string $key, ?Document $existing = null): Document
    {
        $this->ensureVerifiedUploader($user);
        $file = $incoming->file;
        $extension = $incoming->extension();
        if (! in_array($extension, ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg'], true)) {
            throw ValidationException::withMessages(['file' => 'Этот формат не поддерживается.']);
        }
        $this->inspector->inspect($file, $extension);
        $sha = hash_file('sha256', $file->getPathname());
        $scope = 'upload:'.($existing !== null ? $existing->id : 'new');
        $hash = hash('sha256', $sha.'|'.($title ?? '').'|'.$scope);
        $path = Storage::disk('local')->putFileAs('originals', $file, (string) Str::uuid());
        if ($path === false) {
            throw new \RuntimeException('Не удалось сохранить файл в карантин.');
        }
        try {
            return DB::transaction(function () use ($user, $file, $incoming, $title, $key, $existing, $sha, $scope, $hash, $path): Document {
                // Serializes retries for an actor before checking the idempotency key.
                $actor = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
                $this->ensureVerifiedUploader($actor);
                $prior = DB::table('idempotency_records')->where(['user_id' => $user->id, 'scope' => $scope, 'key' => $key])->first();
                if ($prior) {
                    abort_if($prior->request_hash !== $hash, 409, 'Ключ уже использован для другого файла.');
                    Storage::disk('local')->delete($path);

                    return Document::findOrFail($prior->resource_id);
                }
                $document = $existing ? Document::whereKey($existing->id)->lockForUpdate()->firstOrFail() : Document::create(['owner_id' => $user->id, 'title' => $title ?: $incoming->originalName]);
                $version = DocumentVersion::create(['document_id' => $document->id, 'creator_id' => $user->id, 'number' => ($document->versions()->max('number') ?? 0) + 1, 'storage_key' => $path, 'original_name' => basename($incoming->originalName), 'mime' => $file->getMimeType() ?? 'application/octet-stream', 'size' => $file->getSize(), 'sha256' => $sha, 'status' => 'quarantined']);
                $document->update(['desired_version_id' => $version->id, 'revision' => $document->revision + 1]);
                DB::table('outbox_events')->insert(['id' => (string) Str::uuid(), 'type' => 'process.version', 'payload' => json_encode(['version_id' => $version->id], JSON_THROW_ON_ERROR), 'created_at' => now(), 'updated_at' => now()]);
                DB::table('idempotency_records')->insert(['user_id' => $user->id, 'scope' => $scope, 'key' => $key, 'request_hash' => $hash, 'resource_id' => $document->id, 'created_at' => now(), 'updated_at' => now()]);
                Audit::record($user->id, 'version.uploaded', $document->id, ['version_id' => $version->id]);

                return $document;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }
    }

    private function ensureVerifiedUploader(User $user): void
    {
        abort_unless($user->active && $user->role !== 'observer', 403, 'Загрузка недоступна для этой учётной записи.');
        abort_unless($user->hasVerifiedEmail(), 403, 'Подтвердите электронную почту перед загрузкой документов.');
    }
}
