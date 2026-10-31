<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

interface VirusScanner
{
    public function assertClean(string $path): void;
}
