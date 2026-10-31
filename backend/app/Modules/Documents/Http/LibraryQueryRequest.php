<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class LibraryQueryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'q' => 'nullable|string|max:500', 'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100', 'trash' => 'nullable|boolean',
            'favorite' => 'nullable|boolean', 'mine' => 'nullable|boolean',
            'folder_id' => 'nullable|uuid', 'tag_id' => 'nullable|uuid',
            'format' => ['nullable', Rule::in(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg'])],
            'status' => ['nullable', Rule::in(['quarantined', 'scanning', 'extracting', 'recognizing', 'indexing', 'ready', 'failed', 'rejected', 'cancelled'])],
            'created_from' => 'nullable|date_format:Y-m-d', 'created_to' => 'nullable|date_format:Y-m-d|after_or_equal:created_from',
            'updated_from' => 'nullable|date_format:Y-m-d', 'updated_to' => 'nullable|date_format:Y-m-d|after_or_equal:updated_from',
            'sort' => ['nullable', Rule::in(['relevance', 'title', 'created_at', 'updated_at', 'status', 'format', 'size', 'owner'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ];
    }
}
