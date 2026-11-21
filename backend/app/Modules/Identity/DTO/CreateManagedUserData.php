<?php

declare(strict_types=1);

namespace App\Modules\Identity\DTO;

use App\Modules\Identity\Enums\UserRole;

final readonly class CreateManagedUserData
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password,
        public UserRole $role,
    ) {
    }

    /** @return array{name: string, email: string, password: string, role: UserRole} */
    public function toArray(): array
    {
        return ['name' => $this->name, 'email' => $this->email, 'password' => $this->password, 'role' => $this->role];
    }
}
