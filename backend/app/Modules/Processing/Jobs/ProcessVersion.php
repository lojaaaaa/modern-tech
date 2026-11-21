<?php

declare(strict_types=1);

namespace App\Modules\Processing\Jobs;

use App\Modules\Processing\VersionProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

final class ProcessVersion implements ShouldQueue
{
    use Queueable;

    // Waiting on the version lock consumes a delivery, but not a processing attempt.
    public int $tries = 0;

    public int $maxExceptions = 3;

    public int $timeout = 900;

    public function __construct(public string $versionId)
    {
        $this->onQueue('processing');
    }

    public function backoff(): array
    {
        return [10, 60, 300];
    }

    public function handle(VersionProcessing $processing): void
    {
        if (! $processing->tryProcess($this->versionId)) {
            $this->release(30);
        }
    }
}
