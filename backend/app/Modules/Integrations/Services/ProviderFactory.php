<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Models\CloudConnection;

final class ProviderFactory
{
    public function for(CloudConnection $connection): CloudProvider
    {
        $credentials = $connection->credentials;
        if ($connection->provider === 'yandex') {
            $oauth = app(YandexOAuth::class);

            return new YandexDisk($oauth->accessToken($connection), fn (string $token): string => $oauth->accessToken($connection, $token));
        }

        return match ($connection->provider) {
            'mail' => new MailCloud($credentials['email'], $credentials['password']),default => throw new CloudFailure('UNKNOWN_PROVIDER')
        };
    }
}
