<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Services\CloudHttp;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class TransferController
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => CloudTransfer::where('initiator_id', $request->user()->id)->latest()->limit(100)->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_if($request->user()->role === 'observer', 403);
        $data = $request->validate(['connection_id' => 'required|uuid', 'direction' => ['required', Rule::in(['import', 'export'])], 'path' => 'required|string|max:2048', 'filename' => 'required|string|max:255', 'version_id' => 'required_if:direction,export|uuid']);
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 100, 422, 'Нужен ключ операции.');
        $hash = hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));
        $connection = CloudConnection::where('owner_id', $request->user()->id)->where('status', 'connected')->findOrFail($data['connection_id']);
        $path = CloudHttp::validatePath($data['path']);
        $filename = basename(str_replace('\\', '/', $data['filename']));
        abort_if($filename === '' || in_array($filename, ['.', '..'], true), 422);
        $id = (string) Str::uuid();
        $version = null;
        if ($data['direction'] === 'export') {
            $version = DocumentVersion::findOrFail($data['version_id']);
            abort_unless($version->document !== null, 404);
            Gate::authorize('export', $version->document);
            abort_unless($version->status === 'ready', 409);
            $filename = pathinfo($filename, PATHINFO_FILENAME).'-'.substr($id, 0, 8).'.'.pathinfo($version->original_name, PATHINFO_EXTENSION);
            $path = rtrim($path, '/').'/'.$filename;
        }
        $transfer = DB::transaction(function () use ($id, $request, $connection, $data, $path, $filename, $version, $key, $hash) {
            $actor = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            abort_unless($actor->active && $actor->role !== 'observer', 403);
            $prior = DB::table('idempotency_records')->where(['user_id' => $actor->id, 'scope' => 'transfer', 'key' => $key])->first();
            if ($prior) {
                abort_if($prior->request_hash !== $hash, 409, 'Ключ уже использован для другой операции.');

                return CloudTransfer::where('initiator_id', $actor->id)->findOrFail($prior->resource_id);
            }
            $t = new CloudTransfer(['initiator_id' => $request->user()->id, 'connection_id' => $connection->id, 'direction' => $data['direction'], 'version_id' => $version?->id, 'remote_path' => $path, 'filename' => $filename]);
            $t->id = $id;
            $t->save();
            DB::table('idempotency_records')->insert(['user_id' => $actor->id, 'scope' => 'transfer', 'key' => $key, 'request_hash' => $hash, 'resource_id' => $t->id, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('outbox_events')->insert(['id' => (string) Str::uuid(), 'type' => 'process.transfer', 'payload' => json_encode(['transfer_id' => $t->id], JSON_THROW_ON_ERROR), 'created_at' => now(), 'updated_at' => now()]);
            Audit::record($request->user()->id, 'transfer.created', $t->id, ['direction' => $data['direction']]);

            return $t;
        });

        return response()->json(['data' => $transfer->refresh()], 202);
    }

    public function cancel(Request $request, CloudTransfer $transfer): JsonResponse
    {
        abort_unless($transfer->initiator_id === $request->user()->id, 404);
        abort_unless(CloudTransfer::whereKey($transfer->id)->where('status', 'queued')->update(['status' => 'cancelled']) === 1, 409, 'Операция уже началась.');
        $transfer->refresh();

        return response()->json(['data' => $transfer]);
    }
}
