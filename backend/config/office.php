<?php

declare(strict_types=1);

return [
    'public_url' => env('OFFICE_PUBLIC_URL'),
    'internal_url' => env('OFFICE_INTERNAL_URL'),
    'app_internal_url' => env('OFFICE_APP_INTERNAL_URL'),
    'jwt_secret' => env('OFFICE_JWT_SECRET'),
    'max_bytes' => 50 * 1024 * 1024,
];
