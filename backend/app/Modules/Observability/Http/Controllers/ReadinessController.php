<?php

declare(strict_types=1);

namespace App\Modules\Observability\Http\Controllers;

use App\Modules\Observability\Cache\ReadinessCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

final class ReadinessController
{
    public function __invoke(ReadinessCache $cache): JsonResponse
    {
        DB::select('select 1');
        Redis::connection()->ping();
        abort_unless($cache->canReadAndWrite(), 503);

        return response()->json(['status' => 'ready']);
    }
}
