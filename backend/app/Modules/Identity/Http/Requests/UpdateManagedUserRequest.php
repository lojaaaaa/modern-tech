<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Modules\Identity\DTO\UpdateManagedUserData;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class UpdateManagedUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('update', $this->route('user'));
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:120'],
            'role' => ['sometimes', Rule::enum(UserRole::class)],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function getData(): UpdateManagedUserData
    {
        return new UpdateManagedUserData(
            name: $this->input('name'),
            role: $this->enum('role', UserRole::class),
            isActive: $this->has('is_active') ? $this->boolean('is_active') : null,
        );
    }
}
