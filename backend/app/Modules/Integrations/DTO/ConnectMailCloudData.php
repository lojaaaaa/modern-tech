<?php

declare(strict_types=1);

namespace App\Modules\Integrations\DTO;

final readonly class ConnectMailCloudData
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password,
    ) {
    }
}
