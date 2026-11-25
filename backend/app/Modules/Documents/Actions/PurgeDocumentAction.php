<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Collaboration\Services\OfficeEditingStatus;
use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\Document;
use App\Modules\Integrations\Enums\CloudTransferStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

final readonly class PurgeDocumentAction
{
    public function __construct(private OfficeEditingStatus $officeStatus)
    {
    }

    public function handle(User $user, string $id): void
    {
        DB::transaction(function () use ($user, $id): void {
            $document = Document::query()->onlyTrashed()->lockForUpdate()->findOrFail($id);
            Gate::forUser($user)->authorize(DocumentPermission::MANAGE->value, $document);

            $drafts = DB::table('office_drafts')->where('document_id', $id)->lockForUpdate()->get();
            foreach ($drafts as $draft) {
                $this->officeStatus->requireClosed($draft->editor_key);
            }

            $versions = $document->versions()->get(['id', 'storage_key', 'preview_key']);
            $transfers = DB::table('cloud_transfers')
                ->whereIn('version_id', $versions->pluck('id'))
                ->lockForUpdate()
                ->get(['id', 'status']);
            abort_if(
                $transfers->contains('status', CloudTransferStatus::RUNNING->value),
                409,
                'Дождитесь завершения экспорта документа.',
            );
            DB::table('cloud_transfers')->whereIn('id', $transfers->pluck('id'))
                ->where('status', CloudTransferStatus::QUEUED->value)
                ->update(['status' => CloudTransferStatus::CANCELLED->value, 'updated_at' => now()]);
            DB::table('cloud_transfers')->whereIn('id', $transfers->pluck('id'))->update(['version_id' => null]);

            $keys = $versions->pluck('storage_key')
                ->merge($versions->pluck('preview_key'))
                ->merge($drafts->pluck('storage_key'))
                ->filter()->unique()->values()->all();
            DB::table('document_comments')->where('document_id', $id)->delete();
            $document->forceDelete();

            AuditWriter::record($user->id, 'document.purged', $id, ['resource_name' => $document->title]);
            if ($keys !== []) {
                DB::table('outbox_events')->insert([
                    'id' => (string) Str::uuid(),
                    'type' => 'storage.remove_document_files',
                    'payload' => json_encode(['keys' => $keys], JSON_THROW_ON_ERROR),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        });
    }

}
