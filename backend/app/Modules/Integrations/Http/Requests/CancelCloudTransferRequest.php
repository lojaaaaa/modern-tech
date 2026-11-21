<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Http\Requests;

use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

final class CancelCloudTransferRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect('cancel', $this->route('transfer'));
    }
}
