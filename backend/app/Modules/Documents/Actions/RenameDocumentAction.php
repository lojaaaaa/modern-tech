<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\DTO\RenameDocumentData;
use App\Modules\Documents\Models\Document;
use Illuminate\Support\Facades\DB;

final class RenameDocumentAction
{
    public function handle(User $actor, Document $document, RenameDocumentData $data): Document
    {
        return DB::transaction(function () use ($actor, $document, $data): Document {
            $document = Document::query()
                ->whereKey($document->id)
                ->lockForUpdate()
                ->firstOrFail();

            abort_if($document->revision !== $data->revision, 409, __('documents.revision_conflict'));

            $document->update([
                'title' => $data->title,
                'revision' => $document->revision + 1,
            ]);

            AuditWriter::record($actor->id, 'document.updated', $document->id);

            return $document;
        }, attempts: 3);
    }
}
