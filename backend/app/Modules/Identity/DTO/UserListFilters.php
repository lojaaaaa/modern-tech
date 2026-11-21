<?php

declare(strict_types=1);

namespace App\Modules\Identity\DTO;

use App\Modules\Identity\Enums\UserRole;

final readonly class UserListFilters
{
    public function __construct(
        public int $perPage,
        public ?string $search,
        public ?UserRole $role,
        public ?bool $isActive,
        public string $sort,
        public string $direction,
        public ?string $cursor,
    ) {
    }
}
