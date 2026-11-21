<?php

declare(strict_types=1);

namespace App\Modules\Identity\DTO;

final readonly class ResetPasswordData
{
    public function __construct(
        public string $email,
        public string $token,
        public string $password,
    ) {
    }

    /** @return array{email: string, token: string, password: string} */
    public function toArray(): array
    {
        return [
            'email' => $this->email,
            'token' => $this->token,
            'password' => $this->password,
        ];
    }
}
