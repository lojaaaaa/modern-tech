<?php

declare(strict_types=1);

namespace App\Modules\Observability\Http\Requests;

use App\Modules\Observability\Policies\MetricsPolicy;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;

final class MetricsRequest extends FormRequest
{
    public function authorize(MetricsPolicy $policy): Response
    {
        return $policy->view($this->user());
    }
}
