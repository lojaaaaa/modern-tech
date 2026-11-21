<?php

declare(strict_types=1);

namespace App\Modules\Audit\DTO;

final readonly class AuditListFilters
{
    public function __construct(
        public int $perPage,
        public ?string $search,
        public ?string $action,
        public ?int $actorId,
        public ?string $dateFrom,
        public ?string $dateTo,
        public string $sort,
        public string $direction,
    ) {
    }
}
