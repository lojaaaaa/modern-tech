<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Jobs;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Services\UploadDocument;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\ProviderFactory;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Http\UploadedFile;
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

    public function handle(ProviderFactory $providers, UploadDocument $uploads): void
    {
        if (! CloudTransfer::whereKey($this->transferId)->where('status', 'queued')->update(['status' => 'running'])) {
            return;
        }
        $transfer = CloudTransfer::findOrFail($this->transferId);
        $temporary = null;
        $remoteWriteStarted = false;
        try {
            $user = User::find($transfer->initiator_id);
            $connection = CloudConnection::find($transfer->connection_id);
            if (! $user || ! $user->active || $user->role === 'observer' || ! $connection || $connection->owner_id !== $user->id || $connection->status !== 'connected') {
                throw new CloudFailure('ACCESS_REVOKED');
            }
            $provider = $providers->for($connection);
            if ($transfer->direction === 'export') {
                $version = DocumentVersion::find($transfer->version_id);
                if (! $version || ! $version->document || $version->status !== 'ready') {
                    throw new CloudFailure('VERSION_UNAVAILABLE');
                }
                Gate::forUser($user)->authorize('export', $version->document);
                $remoteWriteStarted = true;
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
                // Imported files enter exactly the same quarantine as browser uploads.
                $document = $uploads->execute($user, new UploadedFile($temporary, $transfer->filename, null, null, true), null, 'transfer:'.$transfer->id);
                $transfer->document_id = $document->id;
            }
            $transfer->status = 'completed';
            $transfer->save();
            Audit::record($user->id, 'transfer.completed', $transfer->id);
        } catch (\Throwable $error) {
            $transfer->update(['status' => 'failed', 'error_code' => $error instanceof CloudFailure ? $error->getMessage() : ($remoteWriteStarted ? 'OUTCOME_UNKNOWN' : 'TRANSFER_FAILED')]);
        } finally {
            if (is_string($temporary) && is_file($temporary)) {
                unlink($temporary);
            }
        }
    }

    public function failed(?\Throwable $exception): void
    {
        CloudTransfer::whereKey($this->transferId)->where('status', 'running')->update(['status' => 'failed', 'error_code' => 'OUTCOME_UNKNOWN']);
    }
}
