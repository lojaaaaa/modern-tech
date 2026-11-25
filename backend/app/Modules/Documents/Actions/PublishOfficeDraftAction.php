<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Models\User;
use App\Modules\Collaboration\Services\SavedOfficeDraft;
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
    public function __construct(private SavedOfficeDraft $draft, private UploadDocument $uploads)
    {
    }

    public function handle(User $user, Document $document, string $key): Document
    {
        return DB::transaction(function () use ($user, $document, $key): Document {
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

            $file = $this->draft->file($locked);
            Validator::validate(['file' => $file], ['file' => [new DocumentFile()]]);

            return $this->uploads->execute($actor, $file, null, $uploadKey, $locked);
        });
    }
}
