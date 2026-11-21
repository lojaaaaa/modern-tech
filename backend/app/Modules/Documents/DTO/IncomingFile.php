<?php

declare(strict_types=1);

namespace App\Modules\Documents\DTO;

use Illuminate\Http\File;
use RuntimeException;

/** A local temporary file supplied by an HTTP or integration adapter. */
final readonly class IncomingFile
{
    public File $file;

    public function __construct(string $path, public string $originalName)
    {
        $this->file = new File($path);
    }

    public function extension(): string
    {
        return strtolower(pathinfo($this->originalName, PATHINFO_EXTENSION));
    }

    public function sha256(): string
    {
        $hash = hash_file('sha256', $this->file->getPathname());
        if ($hash === false) {
            throw new RuntimeException('Unable to hash the incoming document.');
        }

        return $hash;
    }
}
