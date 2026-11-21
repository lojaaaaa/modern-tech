<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\DTO\BatchDocumentsData;
use App\Modules\Documents\Enums\BatchDocumentOperation;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class BatchDocumentsRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'uuid', 'distinct'],
            'action' => ['required', Rule::enum(BatchDocumentOperation::class)],
        ];
    }

    public function getData(): BatchDocumentsData
    {
        return new BatchDocumentsData(
            ids: array_values($this->validated('ids')),
            operation: BatchDocumentOperation::from($this->validated('action')),
        );
    }
}
