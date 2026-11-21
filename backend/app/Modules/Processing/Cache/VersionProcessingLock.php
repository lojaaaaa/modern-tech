<?php

declare(strict_types=1);

namespace App\Modules\Processing\Cache;

use Closure;
use Illuminate\Support\Facades\Cache;

final class VersionProcessingLock
{
    private const KEY_PREFIX = 'process-version:';

    private const LOCK_SECONDS = 960;

    /**
     * @template T
     *
     * @param Closure(): T $operation
     * @return T|false
     */
    public function tryRun(string $versionId, Closure $operation): mixed
    {
        return Cache::lock(self::KEY_PREFIX . $versionId, self::LOCK_SECONDS)->get($operation);
    }
}
