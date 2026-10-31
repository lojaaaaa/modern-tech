<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Models\CloudConnection;

final class ProviderFactory
{
    public function for(CloudConnection $connection): CloudProvider
    {
        $credentials = $connection->credentials;

        return match ($connection->provider) {
            'yandex' => new YandexDisk($credentials['token']),'mail' => new MailCloud($credentials['email'], $credentials['password']),default => throw new CloudFailure('UNKNOWN_PROVIDER')
        };
    }
}
