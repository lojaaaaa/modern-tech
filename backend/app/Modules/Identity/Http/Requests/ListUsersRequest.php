<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Models\User;
use App\Modules\Identity\DTO\UserListFilters;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class ListUsersRequest extends FormRequest
{
    public const SORT_FIELDS = ['name', 'email', 'created_at', 'id'];

    public function authorize(): bool
    {
        return $this->user()->can('viewAny', User::class);
    }

    public function rules(): array
    {
        return [
            'cursor' => ['nullable', 'string', 'max:2000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'q' => ['nullable', 'string', 'max:200'],
            'role' => ['nullable', Rule::enum(UserRole::class)],
            'active' => ['nullable', 'boolean'],
            'sort' => ['nullable', Rule::in(self::SORT_FIELDS)],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ];
    }

    public function getFilters(): UserListFilters
    {
        return new UserListFilters(
            perPage: $this->getPerPage(),
            search: $this->getSearch(),
            role: $this->getRole(),
            isActive: $this->getActive(),
            sort: $this->getSort(),
            direction: $this->getDirection(),
            cursor: $this->getCursor(),
        );
    }

    public function getPerPage(): int
    {
        return $this->integer('per_page', 20);
    }

    public function getSearch(): ?string
    {
        return $this->input('q');
    }

    public function getRole(): ?UserRole
    {
        return $this->enum('role', UserRole::class);
    }

    public function getActive(): ?bool
    {
        return $this->filled('active') ? $this->boolean('active') : null;
    }

    public function getSort(): string
    {
        return $this->input('sort') ?? 'name';
    }

    public function getDirection(): string
    {
        return $this->input('direction') ?? 'asc';
    }

    public function getCursor(): ?string
    {
        return $this->input('cursor');
    }
}
