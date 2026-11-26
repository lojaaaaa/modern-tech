<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Models\User;
use App\Modules\Collaboration\Services\OfficeSnapshot;
use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentUploadRecord;
use App\Modules\Documents\Rules\DocumentFile;
use App\Modules\Documents\Services\UploadDocument;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

final readonly class PublishOfficeDraftAction
{
    public function __construct(private UploadDocument $uploads, private OfficeSnapshot $snapshot)
    {
    }

    public function handle(User $user, Document $document, string $key): Document
    {
        Gate::forUser($user)->authorize(DocumentPermission::MANAGE->value, $document);
        $prior = DocumentUploadRecord::query()->where(['user_id' => $user->id, 'scope' => 'upload:'.$document->id, 'key' => 'draft:'.$key])->exists();
        if ($prior) {
            return $document->refresh();
        }
        $sourceVersionId = $document->published_version_id;
        $file = $this->snapshot->capture($document);
        try {
            return DB::transaction(function () use ($user, $document, $key, $file, $sourceVersionId): Document {
                // Keep the same lock order as the upload pipeline.
                $actor = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
                $locked = Document::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
                Gate::forUser($actor)->authorize(DocumentPermission::MANAGE->value, $locked);

                $uploadKey = 'draft:' . $key;
                $prior = DocumentUploadRecord::query()->where([
                    'user_id' => $actor->id, 'scope' => 'upload:' . $locked->id, 'key' => $uploadKey,
                ])->first();
                if ($prior) {
                    return $locked;
                }

                abort_unless($locked->published_version_id === $sourceVersionId, 409, 'Текущая версия изменилась. Откройте документ заново.');
                abort_if($file->sha256() === $locked->publishedVersion->sha256, 409, 'Новых изменений нет.');
                Validator::validate(['file' => $file], ['file' => [new DocumentFile()]]);

                return $this->uploads->execute($actor, $file, null, $uploadKey, $locked);
            });
        } finally {
            $path = $file->file->getPathname();
            $snapshotRoot = \Illuminate\Support\Facades\Storage::disk('local')->path('office-snapshots/');
            if (str_starts_with($path, $snapshotRoot)) {
                @unlink($path);
            }
        }
    }
}
