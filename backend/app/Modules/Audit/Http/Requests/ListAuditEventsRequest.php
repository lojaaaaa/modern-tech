<?php

declare(strict_types=1);

namespace App\Modules\Audit\Http\Requests;

use App\Modules\Audit\DTO\AuditListFilters;
use App\Modules\Audit\Policies\AuditPolicy;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class ListAuditEventsRequest extends FormRequest
{
    public const SORT_FIELDS = ['created_at', 'id', 'action'];

    public function authorize(AuditPolicy $policy): Response
    {
        return $policy->view($this->user());
    }

    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'q' => ['nullable', 'string', 'max:200'],
            'action' => ['nullable', 'string', 'max:100'],
            'actor_id' => ['nullable', 'integer', 'min:1'],
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'sort' => ['nullable', Rule::in(self::SORT_FIELDS)],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ];
    }

    public function getFilters(): AuditListFilters
    {
        $data = $this->validated();

        return new AuditListFilters(
            perPage: $this->integer('per_page', 20),
            search: $data['q'] ?? null,
            action: $data['action'] ?? null,
            actorId: isset($data['actor_id']) ? (int) $data['actor_id'] : null,
            dateFrom: $data['date_from'] ?? null,
            dateTo: $data['date_to'] ?? null,
            sort: $data['sort'] ?? 'created_at',
            direction: $data['direction'] ?? 'desc',
        );
    }
}
