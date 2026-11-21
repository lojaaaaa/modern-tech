<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\DTO\BatchDocumentsData;
use App\Modules\Documents\Enums\BatchDocumentOperation;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Policies\DocumentPolicy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

final readonly class BatchDocumentsAction
{
    public function __construct(private DocumentPolicy $policy)
    {
    }

    public function handle(User $user, BatchDocumentsData $data): int
    {
        return DB::transaction(function () use ($user, $data): int {
            $documents = Document::query()
                ->when(
                    $data->operation === BatchDocumentOperation::RESTORE,
                    fn (Builder $query) => $query->onlyTrashed(),
                )
                ->with(['grants' => fn ($grants) => $grants->where('user_id', $user->id)])
                ->whereKey($data->ids)
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            abort_unless($documents->count() === count($data->ids), 404);

            foreach ($documents as $document) {
                $this->policy->batch($user, $document, $data->operation)->authorize();
            }

            foreach ($documents as $document) {
                match ($data->operation) {
                    BatchDocumentOperation::TRASH => $this->trash($document),
                    BatchDocumentOperation::RESTORE => $this->restore($document),
                    BatchDocumentOperation::FAVORITE => DB::table('document_favorites')->insertOrIgnore([
                        'document_id' => $document->id,
                        'user_id' => $user->id,
                    ]),
                };

                AuditWriter::record($user->id, 'document.batch.' . $data->operation->value, $document->id);
            }

            return $documents->count();
        });
    }

    private function trash(Document $document): void
    {
        $document->update(['purge_after' => now()->addDays(30)]);
        $document->delete();
    }

    private function restore(Document $document): void
    {
        $document->restore();
        $document->update(['purge_after' => null]);
    }
}
