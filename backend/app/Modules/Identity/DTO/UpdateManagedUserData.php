<?php

declare(strict_types=1);

namespace App\Modules\Identity\DTO;

use App\Modules\Identity\Enums\UserRole;

final readonly class UpdateManagedUserData
{
    public function __construct(
        public ?string $name = null,
        public ?UserRole $role = null,
        public ?bool $isActive = null,
    ) {
    }

    /** @return array{name?: string, role?: UserRole, active?: bool} */
    public function toArray(): array
    {
        return array_filter(
            ['name' => $this->name, 'role' => $this->role, 'active' => $this->isActive],
            fn (mixed $value) => $value !== null,
        );
    }
}
