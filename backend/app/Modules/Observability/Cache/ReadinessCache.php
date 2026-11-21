<?php

declare(strict_types=1);

namespace App\Modules\Observability\Cache;

use Illuminate\Support\Facades\Cache;

final class ReadinessCache
{
    private const KEY = 'health:ready';

    private const TTL_SECONDS = 10;

    public function canReadAndWrite(): bool
    {
        Cache::put(self::KEY, true, self::TTL_SECONDS);

        return Cache::get(self::KEY) === true;
    }
}
