<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Requests;

use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Integrations\DTO\QueueCloudTransferData;
use App\Modules\Integrations\Enums\TransferDirection;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Services\CloudHttp;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

final class QueueCloudTransferRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect('create', CloudTransfer::class);
    }

    public function rules(): array
    {
        return [
            'connection_id' => ['required', 'uuid'],
            'direction' => ['required', Rule::in(TransferDirection::cases())],
            'path' => ['required', 'string', 'max:2048'],
            'filename' => ['required', 'string', 'max:255'],
            'version_id' => ['required_if:direction,export', 'uuid'],
        ];
    }

    public function getData(): QueueCloudTransferData
    {
        $key = $this->getIdempotencyKey();
        $connection = $this->getConnection();
        $path = CloudHttp::validatePath($this->validated('path'));
        $filename = basename(str_replace('\\', '/', $this->validated('filename')));
        abort_if($filename === '' || in_array($filename, ['.', '..'], true), 422);

        return new QueueCloudTransferData(
            connection: $connection,
            direction: TransferDirection::from($this->validated('direction')),
            path: $path,
            filename: $filename,
            version: $this->getExportVersion(),
            key: $key,
            requestHash: $this->getRequestHash(),
        );
    }

    public function getConnection(): CloudConnection
    {
        return CloudConnection::query()->ownedBy($this->user())->connected()->findOrFail($this->validated('connection_id'));
    }

    public function getExportVersion(): ?DocumentVersion
    {
        return $this->validated('direction') === TransferDirection::EXPORT->value
            ? DocumentVersion::query()->with('document')->findOrFail($this->validated('version_id'))
            : null;
    }

    protected function passedValidation(): void
    {
        if ($this->validated('direction') === TransferDirection::IMPORT->value) {
            Gate::authorize('create', [CloudTransfer::class, TransferDirection::IMPORT]);
        }
    }

    private function getIdempotencyKey(): string
    {
        $key = $this->header('Idempotency-Key');
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 100, 422, 'Нужен ключ операции.');

        return $key;
    }

    private function getRequestHash(): string
    {
        // Preserve the original input and field order for existing idempotency records.
        $data = [
            'connection_id' => $this->validated('connection_id'),
            'direction' => $this->validated('direction'),
            'path' => $this->validated('path'),
            'filename' => $this->validated('filename'),
        ];
        if ($this->has('version_id')) {
            $data['version_id'] = $this->validated('version_id');
        }

        return hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));
    }
}
