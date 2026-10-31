<?php

declare(strict_types=1);

namespace App\Modules\Documents\Services;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class UploadDocument
{
    public function execute(User $user, UploadedFile $file, ?string $title, string $key, ?Document $existing = null): Document
    {
        $extension = strtolower($file->getClientOriginalExtension());
        if (! in_array($extension, ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg'], true)) {
            throw ValidationException::withMessages(['file' => 'Этот формат не поддерживается.']);
        }
        app(FileInspector::class)->inspect($file);
        $sha = hash_file('sha256', $file->getPathname());
        $scope = 'upload:'.($existing !== null ? $existing->id : 'new');
        $hash = hash('sha256', $sha.'|'.($title ?? '').'|'.$scope);
        $path = $file->store('originals', 'local');
        try {
            return DB::transaction(function () use ($user, $file, $title, $key, $existing, $sha, $scope, $hash, $path): Document {
                // Serializes retries for an actor before checking the idempotency key.
                User::whereKey($user->id)->lockForUpdate()->firstOrFail();
                $prior = DB::table('idempotency_records')->where(['user_id' => $user->id, 'scope' => $scope, 'key' => $key])->first();
                if ($prior) {
                    abort_if($prior->request_hash !== $hash, 409, 'Ключ уже использован для другого файла.');
                    Storage::disk('local')->delete($path);

                    return Document::findOrFail($prior->resource_id);
                }
                $document = $existing ? Document::whereKey($existing->id)->lockForUpdate()->firstOrFail() : Document::create(['owner_id' => $user->id, 'title' => $title ?: $file->getClientOriginalName()]);
                $version = DocumentVersion::create(['document_id' => $document->id, 'creator_id' => $user->id, 'number' => ($document->versions()->max('number') ?? 0) + 1, 'storage_key' => $path, 'original_name' => basename($file->getClientOriginalName()), 'mime' => $file->getMimeType() ?? 'application/octet-stream', 'size' => $file->getSize(), 'sha256' => $sha, 'status' => 'quarantined']);
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
}
