<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Integrations\DTO\QueueCloudTransferData;
use App\Modules\Integrations\Enums\TransferDirection;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Policies\CloudTransferPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class QueueCloudTransferAction
{
    public function __construct(
        private readonly CloudTransferPolicy $transfers,
        private readonly DocumentPolicy $documents,
    ) {
    }

    public function handle(User $user, QueueCloudTransferData $data): CloudTransfer
    {
        $path = $data->path;
        $filename = $data->filename;
        $id = Str::uuid()->toString();
        $version = $data->direction === TransferDirection::EXPORT
            ? ($data->version ?? abort(404))
            : null;
        if ($version !== null) {
            $document = $version->document ?? abort(404);
            $this->documents->export($user, $document)->authorize();
            $this->documents->readVersion($user, $version)->authorize();
            abort_unless($version->isReady(), 409);

            $filename = sprintf(
                '%s-%s.%s',
                pathinfo($filename, PATHINFO_FILENAME),
                substr($id, 0, 8),
                pathinfo($version->original_name, PATHINFO_EXTENSION),
            );
            $path = rtrim($path, '/').'/'.$filename;
        }

        return DB::transaction(function () use ($id, $user, $data, $path, $filename, $version): CloudTransfer {
            $actor = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $this->transfers->create($actor, $data->direction)->authorize();

            $locked = CloudConnection::query()
                ->ownedBy($actor)
                ->connected()
                ->whereKey($data->connection->id)
                ->lockForUpdate()
                ->firstOrFail();

            $scope = ['user_id' => $actor->id, 'scope' => 'transfer', 'key' => $data->key];
            $prior = DB::table('idempotency_records')->where($scope)->first();
            if ($prior !== null) {
                abort_if($prior->request_hash !== $data->requestHash, 409, 'Ключ уже использован для другой операции.');

                return CloudTransfer::query()->initiatedBy($actor)->findOrFail($prior->resource_id);
            }

            $transfer = new CloudTransfer([
                'initiator_id' => $actor->id,
                'connection_id' => $locked->id,
                'direction' => $data->direction,
                'version_id' => $version?->id,
                'remote_path' => $path,
                'filename' => $filename,
            ]);
            $transfer->id = $id;
            $transfer->save();

            $time = now();
            DB::table('idempotency_records')->insert($scope + [
                'request_hash' => $data->requestHash,
                'resource_id' => $transfer->id,
                'created_at' => $time,
                'updated_at' => $time,
            ]);
            DB::table('outbox_events')->insert([
                'id' => Str::uuid()->toString(),
                'type' => 'process.transfer',
                'payload' => json_encode(['transfer_id' => $transfer->id], JSON_THROW_ON_ERROR),
                'created_at' => $time,
                'updated_at' => $time,
            ]);
            AuditWriter::record($actor->id, 'transfer.created', $transfer->id, ['direction' => $data->direction->value]);

            return $transfer;
        })->refresh();
    }

}
