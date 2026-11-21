<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\DTO\ReplaceDocumentGrantsData;
use App\Modules\Documents\Policies\DocumentPolicy;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;

final class ReplaceDocumentGrantsRequest extends FormRequest
{
    public function authorize(DocumentPolicy $policy): Response
    {
        return $policy->manage($this->user(), $this->route('document'));
    }

    public function rules(): array
    {
        return [
            'grants' => ['required', 'array', 'max:100'],
            'grants.*.user_id' => ['required', 'integer', 'distinct'],
            'grants.*.read' => ['required', 'boolean'],
            'grants.*.comment' => ['required', 'boolean'],
            'grants.*.edit' => ['required', 'boolean'],
            'grants.*.export' => ['required', 'boolean'],
        ];
    }

    public function getData(): ReplaceDocumentGrantsData
    {
        $grants = array_map(
            fn (array $grant): array => [
                'user_id' => (int) $grant['user_id'],
                'read' => (bool) $grant['read'],
                'comment' => (bool) $grant['comment'],
                'edit' => (bool) $grant['edit'],
                'export' => (bool) $grant['export'],
            ],
            $this->validated('grants'),
        );

        return new ReplaceDocumentGrantsData($grants);
    }
}
