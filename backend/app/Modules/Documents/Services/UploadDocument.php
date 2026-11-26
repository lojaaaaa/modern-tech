<?php

declare(strict_types=1);

namespace App\Modules\Documents\Services;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\DTO\IncomingFile;
use App\Modules\Documents\Enums\DocumentVersionStatus;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentUploadRecord;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Documents\Rules\DocumentFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

final class UploadDocument
{
    public function __construct(private readonly DocumentPolicy $policy)
    {
    }

    public function import(User $user, IncomingFile $incoming, string $key): Document
    {
        Validator::validate(['file' => $incoming], ['file' => [new DocumentFile()]]);

        return $this->execute($user, $incoming, null, $key);
    }

    /** Persist a file already checked by the upload request or the import entry point. */
    public function execute(
        User $user,
        IncomingFile $incoming,
        ?string $title,
        string $key,
        ?Document $existing = null,
    ): Document {
        $sha256 = $incoming->sha256();
        $upload = DocumentUploadRecord::forUpload($user, $key, $sha256, $title, $existing);
        $path = Storage::disk('local')->putFileAs('originals', $incoming->file, (string) Str::uuid());
        if ($path === false) {
            throw new RuntimeException('Не удалось сохранить файл в карантин.');
        }

        try {
            return DB::transaction(
                function () use ($user, $incoming, $title, $existing, $sha256, $upload, $path): Document {
                    // Serialize retries and recheck access against the current account state.
                    $actor = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
                    $this->policy->create($actor)->authorize();

                    $prior = $upload->findPrevious();
                    if ($prior !== null) {
                        abort_if(
                            $prior->request_hash !== $upload->request_hash,
                            409,
                            __('documents.idempotency_key_conflict'),
                        );
                        Storage::disk('local')->delete($path);

                        return Document::query()->findOrFail($prior->resource_id);
                    }

                    $document = $existing === null
                        ? Document::query()->create([
                            'owner_id' => $actor->id,
                            'title' => $title ?: $incoming->originalName,
                        ])
                        : Document::query()->whereKey($existing->id)->lockForUpdate()->firstOrFail();

                    if ($existing !== null) {
                        $this->policy->uploadVersion($actor, $document)->authorize();
                    }
                    $usage = DocumentVersion::query()->where('creator_id', $actor->id);
                    abort_if((clone $usage)->count() >= config('documents.max_account_versions'), 429, 'Достигнут лимит версий аккаунта.');
                    abort_if((clone $usage)->sum('size') + $incoming->file->getSize() > config('documents.max_account_bytes'), 413, 'Недостаточно места в квоте аккаунта.');
                    $version = DocumentVersion::query()->create([
                        'document_id' => $document->id,
                        'creator_id' => $actor->id,
                        'number' => ($document->versions()->max('number') ?? 0) + 1,
                        'storage_key' => $path,
                        'original_name' => basename($incoming->originalName),
                        'mime' => $incoming->file->getMimeType() ?? 'application/octet-stream',
                        'size' => $incoming->file->getSize(),
                        'sha256' => $sha256,
                        'status' => DocumentVersionStatus::QUARANTINED->value,
                    ]);

                    $document->update([
                        'desired_version_id' => $version->id,
                        'revision' => $document->revision + 1,
                    ]);

                    DB::table('outbox_events')->insert([
                        'id' => (string) Str::uuid(),
                        'type' => 'process.version',
                        'payload' => json_encode(['version_id' => $version->id], JSON_THROW_ON_ERROR),
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);

                    $upload->resource_id = $document->id;
                    $upload->save();

                    AuditWriter::record($actor->id, 'version.uploaded', $document->id, ['version_id' => $version->id]);

                    return $document;
                },
            );
        } catch (Throwable $error) {
            Storage::disk('local')->delete($path);

            throw $error;
        }
    }
}
