<?php

declare(strict_types=1);

namespace App\Modules\Documents\DTO;

final readonly class RenameDocumentData
{
    public function __construct(
        public string $title,
        public int $revision,
    ) {
    }
}
