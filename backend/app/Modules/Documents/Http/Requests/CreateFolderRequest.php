<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\Models\Folder;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Foundation\Http\FormRequest;

final class CreateFolderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role !== UserRole::OBSERVER;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'parent_id' => ['nullable', 'uuid'],
        ];
    }

    public function getParent(): ?Folder
    {
        $parentId = $this->validated('parent_id');

        return $parentId === null
            ? null
            : Folder::query()->where('owner_id', $this->user()->id)->findOrFail($parentId);
    }
}
