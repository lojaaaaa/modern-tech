<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Requests;

use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;

final class StartGoogleOAuthRequest extends FormRequest
{
    public function authorize(): Response
    {
        return $this->user()->role === UserRole::OBSERVER
            ? Response::deny('Запрос отклонён.')
            : Response::allow();
    }

    public function rules(): array
    {
        return ['connection_id' => ['nullable', 'uuid']];
    }

    public function getConnection(): ?CloudConnection
    {
        if (! $this->filled('connection_id')) {
            return null;
        }

        return CloudConnection::query()
            ->ownedBy($this->user())
            ->where('provider', CloudProviderId::GOOGLE->value)
            ->findOrFail($this->validated('connection_id'));
    }
}
