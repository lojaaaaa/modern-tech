<?php

declare(strict_types=1);

namespace App\Modules\Documents\DTO;

use App\Modules\Documents\Enums\BatchDocumentOperation;

final readonly class BatchDocumentsData
{
    /** @param list<string> $ids */
    public function __construct(
        public array $ids,
        public BatchDocumentOperation $operation,
    ) {
    }
}
