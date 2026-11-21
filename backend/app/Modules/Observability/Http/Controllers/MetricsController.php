<?php

declare(strict_types=1);

namespace App\Modules\Observability\Http\Controllers;

use App\Modules\Observability\Actions\CollectMetricsAction;
use App\Modules\Observability\Http\Requests\MetricsRequest;
use Illuminate\Http\Response;

final class MetricsController
{
    public function __invoke(MetricsRequest $request, CollectMetricsAction $action): Response
    {
        return response($action->handle(), headers: [
            'Content-Type' => 'text/plain; version=0.0.4',
        ]);
    }
}
