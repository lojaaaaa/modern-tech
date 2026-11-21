<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Exceptions\CloudAuthorizationRequired;
use App\Modules\Integrations\Models\CloudConnection;

final class ProviderFactory
{
    public function __construct(private readonly YandexOAuth $yandexOAuth)
    {
    }

    public function for(CloudConnection $connection): CloudProvider
    {
        return match (CloudProviderId::tryFrom($connection->provider)) {
            CloudProviderId::MAIL => $this->mailCloud($connection),
            CloudProviderId::YANDEX => new YandexDisk(
                $this->yandexOAuth->getAccessToken($connection),
                fn (string $token): string => $this->yandexOAuth->getAccessToken($connection, $token),
            ),
            null => throw new CloudFailure('UNKNOWN_PROVIDER'),
        };
    }

    private function mailCloud(CloudConnection $connection): MailCloud
    {
        $credentials = $connection->credentials;
        $email = $credentials['email'] ?? null;
        $password = $credentials['password'] ?? null;
        if (! is_string($email) || $email === '' || ! is_string($password) || $password === '') {
            throw new CloudAuthorizationRequired(CloudProviderId::MAIL);
        }

        return new MailCloud($email, $password);
    }
}
