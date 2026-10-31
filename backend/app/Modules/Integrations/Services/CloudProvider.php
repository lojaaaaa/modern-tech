<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

interface CloudProvider
{
    /** @return array<int,array{name:string,path:string,type:string,size:int}> */
    public function files(string $path): array;

    public function download(string $path, string $destination): void;

    public function upload(string $path, string $source): void;
}
