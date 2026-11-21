<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Exceptions;

use App\Modules\Integrations\Services\CloudFailure;

final class CloudOAuthNotConfigured extends CloudFailure
{
    public function __construct()
    {
        parent::__construct('OAUTH_NOT_CONFIGURED');
    }
}
