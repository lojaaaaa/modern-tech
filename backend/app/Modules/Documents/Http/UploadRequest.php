<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http;

use Illuminate\Foundation\Http\FormRequest;

final class UploadRequest extends FormRequest
{
    public function authorize(): bool
    {
        abort_unless($this->user()->hasVerifiedEmail(), 403, 'Подтвердите электронную почту перед загрузкой документов.');

        return $this->user()->active && $this->user()->role !== 'observer';
    }

    public function rules(): array
    {
        return ['file' => ['required', 'file', function (string $attribute, mixed $value, \Closure $fail): void {
            if ($value->getSize() === 0) {
                $fail('Файл не должен быть пустым.');
            }
        }, 'max:51200', 'mimes:pdf,docx,xlsx,pptx,txt,md,csv,png,jpg,jpeg'], 'title' => ['nullable', 'string', 'max:255']];
    }
}
