<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\Folder;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

final class MoveDocumentRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect(DocumentPermission::MANAGE->value, $this->route('document'));
    }

    public function rules(): array
    {
        return ['folder_id' => ['nullable', 'uuid']];
    }

    public function getFolder(): ?Folder
    {
        $folderId = $this->validated('folder_id');
        if ($folderId === null) {
            return null;
        }

        $folder = Folder::query()->where('owner_id', $this->route('document')->owner_id)->find($folderId);
        abort_if($folder === null, 422);

        return $folder;
    }
}
