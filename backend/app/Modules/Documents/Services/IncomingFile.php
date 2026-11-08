<?php

declare(strict_types=1);

namespace App\Modules\Documents\Services;

use Symfony\Component\HttpFoundation\File\File;

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
}
