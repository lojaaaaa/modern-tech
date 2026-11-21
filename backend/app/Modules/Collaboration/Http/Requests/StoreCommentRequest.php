<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Http\Requests;

use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

final class StoreCommentRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect(DocumentPermission::COMMENT->value, $this->route('document'));
    }

    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:5000'],
            'version_id' => ['required', 'uuid'],
            'parent_id' => ['nullable', 'uuid'],
            'anchor_start' => ['nullable', 'integer', 'min:0', 'required_with:anchor_end,anchor_quote'],
            'anchor_end' => ['nullable', 'integer', 'gt:anchor_start', 'required_with:anchor_start,anchor_quote'],
            'anchor_quote' => ['nullable', 'string', 'max:2000', 'required_with:anchor_start,anchor_end'],
        ];
    }

    public function getVersion(): DocumentVersion
    {
        $version = $this->route('document')->versions()->find($this->validated('version_id'));
        abort_if($version === null, 422);

        return $version;
    }
}
