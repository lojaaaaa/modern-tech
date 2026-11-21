<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Requests;

use App\Modules\Integrations\DTO\ConnectMailCloudData;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Auth\Access\Response;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

final class ConnectMailCloudRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect('create', CloudConnection::class);
    }

    public function rules(): array
    {
        return [
            'provider' => ['required', Rule::in([CloudProviderId::MAIL->value])],
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:4096'],
        ];
    }

    public function getData(): ConnectMailCloudData
    {
        return new ConnectMailCloudData(
            name: $this->validated('name'),
            email: $this->validated('email'),
            password: $this->validated('password'),
        );
    }

    protected function failedValidation(Validator $validator): void
    {
        abort_if(
            $this->input('provider') === CloudProviderId::YANDEX->value,
            422,
            'Подключите Яндекс Диск через авторизацию в Яндексе.',
        );

        parent::failedValidation($validator);
    }
}
