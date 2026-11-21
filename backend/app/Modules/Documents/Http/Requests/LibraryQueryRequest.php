<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\DTO\DocumentListFilters;
use App\Modules\Documents\Enums\DocumentVersionStatus;
use App\Modules\Documents\Rules\DocumentFile;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class LibraryQueryRequest extends FormRequest
{
    private const SORT_FIELDS = ['relevance', 'title', 'created_at', 'updated_at', 'status', 'format', 'size', 'owner'];

    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'q' => 'nullable|string|max:500',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
            'trash' => 'nullable|boolean',
            'favorite' => 'nullable|boolean',
            'mine' => 'nullable|boolean',
            'folder_id' => 'nullable|uuid',
            'tag_id' => 'nullable|uuid',
            'format' => ['nullable', Rule::in(DocumentFile::FORMATS)],
            'status' => ['nullable', Rule::enum(DocumentVersionStatus::class)],
            'created_from' => 'nullable|date_format:Y-m-d',
            'created_to' => 'nullable|date_format:Y-m-d|after_or_equal:created_from',
            'updated_from' => 'nullable|date_format:Y-m-d',
            'updated_to' => 'nullable|date_format:Y-m-d|after_or_equal:updated_from',
            'sort' => ['nullable', Rule::in(self::SORT_FIELDS)],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ];
    }

    public function getData(): DocumentListFilters
    {
        $term = $this->validated('q');

        return new DocumentListFilters(
            term: $term,
            page: $this->integer('page', 1) ?: 1,
            perPage: $this->integer('per_page', 12) ?: 12,
            isTrash: $this->boolean('trash'),
            isMine: $this->boolean('mine'),
            isFavorite: $this->boolean('favorite'),
            folderId: $this->validated('folder_id'),
            tagId: $this->validated('tag_id'),
            format: $this->validated('format'),
            status: $this->enum('status', DocumentVersionStatus::class),
            createdFrom: $this->validated('created_from'),
            createdTo: $this->validated('created_to'),
            updatedFrom: $this->validated('updated_from'),
            updatedTo: $this->validated('updated_to'),
            sort: $this->validated('sort') ?? ($term === null ? 'updated_at' : 'relevance'),
            direction: $this->validated('direction') ?? 'desc',
        );
    }
}
