<?php

declare(strict_types=1);

namespace App\Modules\Documents\DTO;

use App\Modules\Documents\Enums\DocumentVersionStatus;

final readonly class DocumentListFilters
{
    public function __construct(
        public ?string $term,
        public int $page,
        public int $perPage,
        public bool $isTrash,
        public bool $isMine,
        public ?string $folderId,
        public ?string $tagId,
        public ?string $format,
        public ?DocumentVersionStatus $status,
        public ?string $createdFrom,
        public ?string $createdTo,
        public ?string $updatedFrom,
        public ?string $updatedTo,
        public string $sort,
        public string $direction,
    ) {
    }
}
