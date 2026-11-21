<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Enums\CloudEntryType;

interface CloudProvider
{
    /** @return list<array{name: string, path: string, type: CloudEntryType, size: int}> */
    public function files(string $path): array;

    public function download(string $path, string $destination): void;

    public function upload(string $path, string $source): void;
}
