<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Jobs;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\DTO\IncomingFile;
use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Documents\Services\UploadDocument;
use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Enums\CloudConnectionStatus;
use App\Modules\Integrations\Enums\CloudTransferStatus;
use App\Modules\Integrations\Enums\TransferDirection;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\ProviderFactory;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

final class ProcessTransfer implements ShouldQueue
{
    use Queueable;

    // An interrupted remote write requires reconciliation, never blind replay.
    public int $tries = 1;

    public int $timeout = 900;

    public function __construct(public string $transferId)
    {
        $this->onQueue('transfers');
    }

    public function handle(ProviderFactory $providers, UploadDocument $uploads, DocumentPolicy $documents): void
    {
        if (! CloudTransfer::query()
            ->whereKey($this->transferId)
            ->where('status', CloudTransferStatus::QUEUED)
            ->update(['status' => CloudTransferStatus::RUNNING])) {
            return;
        }
        $transfer = CloudTransfer::query()->findOrFail($this->transferId);
        $temporary = null;
        $isRemoteWriteStarted = false;
        try {
            $user = User::query()->find($transfer->initiator_id);
            $connection = CloudConnection::query()->find($transfer->connection_id);
            if (! $user || ! $user->isActive() || $user->role === UserRole::OBSERVER || ! $connection || $connection->owner_id !== $user->id || $connection->status !== CloudConnectionStatus::CONNECTED) {
                throw new CloudFailure('ACCESS_REVOKED');
            }
            if ($transfer->direction === TransferDirection::IMPORT && $user->cannot('create', Document::class)) {
                throw new CloudFailure('ACCESS_REVOKED');
            }
            $provider = $providers->for($connection);
            if ($transfer->direction === TransferDirection::EXPORT) {
                $version = DocumentVersion::query()->find($transfer->version_id);
                if (! $version || ! $version->document || ! $version->isReady()) {
                    throw new CloudFailure('VERSION_UNAVAILABLE');
                }
                Gate::forUser($user)->authorize(DocumentPermission::EXPORT->value, $version->document);
                $documents->readVersion($user, $version)->authorize();
                $isRemoteWriteStarted = true;
                $provider->upload($transfer->remote_path, Storage::disk('local')->path($version->storage_key));
            } else {
                $temporary = tempnam(sys_get_temp_dir(), 'cloud-import-');
                if ($temporary === false) {
                    throw new CloudFailure('TEMPORARY_STORAGE_UNAVAILABLE');
                }
                $provider->download($transfer->remote_path, $temporary);
                $size = filesize($temporary);
                if ($size === false || $size === 0 || $size > 52_428_800) {
                    throw new CloudFailure('INVALID_FILE_SIZE');
                }
                // Downloading can take a long time: do not import a file after
                // the owner or their connection was disabled in the meantime.
                $user = User::query()->find($transfer->initiator_id);
                $connection = CloudConnection::query()->find($transfer->connection_id);
                if (
                    !$user
                    || $user->cannot('create', Document::class)
                    || !$connection
                    || $connection->owner_id !== $user->id
                    || $connection->status !== CloudConnectionStatus::CONNECTED
                ) {
                    throw new CloudFailure('ACCESS_REVOKED');
                }
                // Imported files enter exactly the same quarantine as browser uploads.
                $document = $uploads->import(
                    $user,
                    new IncomingFile($temporary, $transfer->filename),
                    'transfer:' . $transfer->id,
                );
                $transfer->document_id = $document->id;
            }
            $transfer->status = CloudTransferStatus::COMPLETED;
            $transfer->save();
            AuditWriter::record($user->id, 'transfer.completed', $transfer->id);
        } catch (\Throwable $error) {
            $transfer->update(['status' => CloudTransferStatus::FAILED, 'error_code' => $error instanceof CloudFailure ? $error->getMessage() : ($isRemoteWriteStarted ? 'OUTCOME_UNKNOWN' : 'TRANSFER_FAILED')]);
        } finally {
            if (is_string($temporary) && is_file($temporary)) {
                unlink($temporary);
            }
        }
    }

    public function failed(?\Throwable $exception): void
    {
        CloudTransfer::query()
            ->whereKey($this->transferId)
            ->where('status', CloudTransferStatus::RUNNING)
            ->update(['status' => CloudTransferStatus::FAILED, 'error_code' => 'OUTCOME_UNKNOWN']);
    }
}
