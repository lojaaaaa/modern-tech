<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Requests;

use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

final class ListCloudFilesRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect('listFiles', $this->route('connection'));
    }

    public function rules(): array
    {
        return ['path' => ['nullable', 'string', 'max:2048']];
    }

    public function getPath(): string
    {
        return $this->validated('path') ?? '/';
    }
}
