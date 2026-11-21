<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\Policies\DocumentPolicy;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;

final class PreviewRequest extends FormRequest
{
    public function authorize(DocumentPolicy $policy): Response
    {
        return $policy->preview($this->user(), $this->route('version'));
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('status')) {
            $this->merge([
                'status' => filter_var($this->input('status'), FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE),
            ]);
        }
    }

    public function rules(): array
    {
        return ['status' => ['sometimes', 'required', 'boolean']];
    }

    public function wantsPreviewStatus(): bool
    {
        return $this->boolean('status');
    }
}
