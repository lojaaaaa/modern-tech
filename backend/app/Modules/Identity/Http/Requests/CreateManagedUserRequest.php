<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Models\User;
use App\Modules\Identity\DTO\CreateManagedUserData;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class CreateManagedUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', User::class);
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('email'))) {
            $this->merge(['email' => Str::lower($this->input('email'))]);
        }
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'unique:users', 'max:255'],
            'password' => ['required', 'string', 'min:12', 'max:128'],
            'role' => ['required', Rule::enum(UserRole::class)],
        ];
    }

    public function getData(): CreateManagedUserData
    {
        return new CreateManagedUserData(
            name: $this->string('name')->toString(),
            email: $this->string('email')->toString(),
            password: $this->string('password')->toString(),
            role: UserRole::from($this->string('role')->toString()),
        );
    }

    public function messages(): array
    {
        return ['email.unique' => __('identity.email_in_use')];
    }
}
