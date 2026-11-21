<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Exceptions\CloudAuthorizationRequired;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\Http;
use League\OAuth2\Client\OptionProvider\HttpBasicAuthOptionProvider;
use League\OAuth2\Client\Provider\GenericProvider;
use Psr\Http\Message\ResponseInterface;

final class YandexOAuthProvider extends GenericProvider
{
    public function __construct()
    {
        parent::__construct([
            'clientId' => config('services.yandex.client_id'),
            'clientSecret' => config('services.yandex.client_secret'),
            'redirectUri' => config('services.yandex.redirect_uri'),
            'urlAuthorize' => 'https://oauth.yandex.ru/authorize',
            'urlAccessToken' => 'https://oauth.yandex.ru/token',
            'urlResourceOwnerDetails' => YandexDisk::API_URL,
            'scopes' => ['cloud_api:disk.read', 'cloud_api:disk.write', 'cloud_api:disk.info'],
            'scopeSeparator' => ' ',
            'pkceMethod' => self::PKCE_METHOD_S256,
        ], [
            'httpClient' => new Client([
                'handler' => Http::createPendingRequest()->buildHandlerStack(),
                'connect_timeout' => 5,
                'timeout' => 15,
                'allow_redirects' => false,
            ]),
            'optionProvider' => new HttpBasicAuthOptionProvider(),
        ]);
    }

    protected function checkResponse(ResponseInterface $response, $data): void
    {
        if ($response->getStatusCode() < 200 || $response->getStatusCode() >= 300 || isset($data['error'])) {
            throw ($data['error'] ?? null) === 'invalid_grant'
                ? new CloudAuthorizationRequired(CloudProviderId::YANDEX)
                : new CloudFailure('PROVIDER_UNAVAILABLE');
        }
    }

    protected function prepareAccessTokenResponse(array $result): array
    {
        if (! is_string($result['access_token'] ?? null) || empty($result['access_token'])
            || ! is_string($result['refresh_token'] ?? null) || empty($result['refresh_token'])
            || ! is_numeric($result['expires_in'] ?? null) || $result['expires_in'] <= 0) {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }

        return $result;
    }
}
