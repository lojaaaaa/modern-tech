<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Requests;

use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

final class DisconnectCloudConnectionRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect('disconnect', $this->route('connection'));
    }
}
