<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Exceptions;

use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Services\CloudFailure;

final class CloudAuthorizationRequired extends CloudFailure
{
    public function __construct(private readonly CloudProviderId $provider)
    {
        parent::__construct('AUTHORIZATION_REQUIRED');
    }

    public function recoveryMessage(): string
    {
        return match ($this->provider) {
            CloudProviderId::MAIL => 'Mail отклонил данные доступа. Проверьте почту и пароль приложения с доступом к Облаку.',
            CloudProviderId::YANDEX => 'Доступ к Яндекс Диску истёк или отозван. Подключите диск заново через Яндекс.',
        };
    }
}
