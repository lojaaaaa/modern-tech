<?php

declare(strict_types=1);

return [
    'tika_url' => env('TIKA_URL', 'http://tika:9998'),
    'gotenberg_url' => env('GOTENBERG_URL', 'http://gotenberg:3000'),
    'clamav_host' => env('CLAMAV_HOST', 'clamav'),
    'clamav_port' => (int) env('CLAMAV_PORT', 3310),
];
