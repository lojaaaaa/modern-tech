<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Models\User;
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
            $this->merge(['email' => Str::lower(trim($this->input('email')))]);
        }
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:255', function (string $attribute, mixed $value, Closure $fail): void {
                if (User::whereRaw('lower(email) = ?', [$value])->exists()) {
                    $fail('Этот email уже используется.');
                }
            }],
            'password' => ['required', 'string', 'min:12', 'max:128', 'confirmed'],
            'role' => ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'role.prohibited' => 'Самостоятельная регистрация создаёт только сотрудника.',
            'password.confirmed' => 'Пароли должны совпадать.',
            'password.min' => 'Пароль должен содержать не меньше 12 символов.',
        ];
    }
}
