<?php

declare(strict_types=1);

namespace App\Modules\Observability\Actions;

use App\Modules\Observability\Services\PrometheusMetricsCollector;

final class CollectMetricsAction
{
    public function __construct(private readonly PrometheusMetricsCollector $collector)
    {
    }

    public function handle(): string
    {
        return implode("\n", $this->collector->collect()) . "\n";
    }
}
