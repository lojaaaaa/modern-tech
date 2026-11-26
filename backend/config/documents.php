<?php

declare(strict_types=1);

return [
    'max_account_bytes' => (int) env('DOCUMENTS_MAX_ACCOUNT_BYTES', 1073741824),
    'max_account_versions' => (int) env('DOCUMENTS_MAX_ACCOUNT_VERSIONS', 1000),
];
