<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Modules\Identity\DTO\ResetPasswordData;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;

final class ResetPasswordRequest extends FormRequest
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
            'email' => ['required', 'email', 'max:255'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:12', 'max:128', 'confirmed'],
        ];
    }

    public function getData(): ResetPasswordData
    {
        return new ResetPasswordData(
            email: $this->string('email')->toString(),
            token: $this->string('token')->toString(),
            password: $this->string('password')->toString(),
        );
    }
}
