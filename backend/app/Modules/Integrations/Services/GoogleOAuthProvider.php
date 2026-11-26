<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Exceptions\CloudAuthorizationRequired;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\Http;
use League\OAuth2\Client\Provider\GenericProvider;
use Psr\Http\Message\ResponseInterface;

final class GoogleOAuthProvider extends GenericProvider
{
    public function __construct()
    {
        parent::__construct([
            'clientId' => config('services.google.client_id'),
            'clientSecret' => config('services.google.client_secret'),
            'redirectUri' => config('services.google.redirect_uri'),
            'urlAuthorize' => 'https://accounts.google.com/o/oauth2/v2/auth',
            'urlAccessToken' => 'https://oauth2.googleapis.com/token',
            'urlResourceOwnerDetails' => GoogleDisk::API_URL.'/about?fields=user',
            'scopes' => ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
            'scopeSeparator' => ' ',
            'pkceMethod' => self::PKCE_METHOD_S256,
        ], [
            'httpClient' => new Client([
                'handler' => Http::createPendingRequest()->buildHandlerStack(),
                'connect_timeout' => 5,
                'timeout' => 15,
                'allow_redirects' => false,
            ]),

        ]);
    }

    protected function checkResponse(ResponseInterface $response, $data): void
    {
        if ($response->getStatusCode() < 200 || $response->getStatusCode() >= 300 || isset($data['error'])) {
            throw ($data['error'] ?? null) === 'invalid_grant'
                ? new CloudAuthorizationRequired(CloudProviderId::GOOGLE)
                : new CloudFailure('PROVIDER_UNAVAILABLE');
        }
    }

    protected function prepareAccessTokenResponse(array $result): array
    {
        if (! is_string($result['access_token'] ?? null) || empty($result['access_token'])
            || ! is_numeric($result['expires_in'] ?? null) || $result['expires_in'] <= 0) {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }

        return $result;
    }
}
