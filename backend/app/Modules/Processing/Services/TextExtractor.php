<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

interface TextExtractor
{
    public function extract(string $path, string $mime): string;
}
