<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Models\User;
use App\Modules\Identity\DTO\RegisterUserData;
use Closure;
use Dedoc\Scramble\Attributes\IgnoreParam;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;

#[IgnoreParam('role', in: 'body')]
final class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
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
            'email' => ['required', 'string', 'email', 'max:255', function (string $attribute, mixed $value, Closure $fail): void {
                if (User::query()->whereRaw('lower(email) = ?', [$value])->exists()) {
                    $fail(__('identity.email_in_use'));
                }
            }],
            'password' => ['required', 'string', 'min:12', 'max:128', 'confirmed'],
            'role' => ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'role.prohibited' => __('identity.registration_employee_only'),
            'password.confirmed' => __('identity.password_confirmation'),
            'password.min' => __('identity.password_min'),
        ];
    }

    public function getData(): RegisterUserData
    {
        return new RegisterUserData(
            name: $this->string('name')->toString(),
            email: $this->string('email')->toString(),
            password: $this->string('password')->toString(),
        );
    }
}
