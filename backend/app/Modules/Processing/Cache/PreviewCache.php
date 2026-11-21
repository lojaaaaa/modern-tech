<?php

declare(strict_types=1);

namespace App\Modules\Processing\Cache;

use Closure;
use Illuminate\Support\Facades\Cache;

final class PreviewCache
{
    private const ERROR_KEY_PREFIX = 'preview-error:';

    private const REQUEST_KEY_PREFIX = 'preview-request:';

    private const GENERATION_LOCK_PREFIX = 'preview:';

    private const ERROR_TTL_SECONDS = 300;

    private const REQUEST_TTL_SECONDS = 240;

    private const GENERATION_LOCK_SECONDS = 240;

    public function reserve(string $versionId): bool
    {
        return ! $this->hasError($versionId)
            && Cache::add(self::REQUEST_KEY_PREFIX . $versionId, true, self::REQUEST_TTL_SECONDS);
    }

    public function hasError(string $versionId): bool
    {
        return Cache::has(self::ERROR_KEY_PREFIX . $versionId);
    }

    public function record(string $versionId): void
    {
        Cache::put(self::ERROR_KEY_PREFIX . $versionId, true, self::ERROR_TTL_SECONDS);
    }

    public function clear(string $versionId): void
    {
        Cache::forget(self::ERROR_KEY_PREFIX . $versionId);
    }

    /** @param Closure(): void $generate */
    public function generate(string $versionId, Closure $generate): void
    {
        Cache::lock(self::GENERATION_LOCK_PREFIX . $versionId, self::GENERATION_LOCK_SECONDS)->get($generate);
    }
}
