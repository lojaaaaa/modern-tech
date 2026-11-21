<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Enums\CloudEntryType;
use App\Modules\Integrations\Enums\CloudProviderId;
use Closure;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;

final class YandexDisk implements CloudProvider
{
    public const API_URL = 'https://cloud-api.yandex.net/v1/disk';

    public function __construct(private string $token, private ?Closure $refreshToken = null)
    {
    }

    private function client(): PendingRequest
    {
        return CloudHttp::client()->withToken($this->token, 'OAuth')->baseUrl(self::API_URL);
    }

    private function resource(string $path, array $parameters): Response
    {
        $response = $this->client()->get($path, $parameters);
        if ($response->status() === 401 && $this->refreshToken !== null) {
            $this->token = ($this->refreshToken)($this->token);
            $response = $this->client()->get($path, $parameters);
        }
        CloudHttp::check($response, CloudProviderId::YANDEX);

        return $response;
    }

    /** @return array{id: string, label: ?string} */
    public function getAccount(): array
    {
        try {
            $response = $this->client()->connectTimeout(5)->timeout(15)->get(self::API_URL);
        } catch (ConnectionException) {
            throw new CloudFailure('PROVIDER_UNAVAILABLE');
        }
        CloudHttp::check($response, CloudProviderId::YANDEX);
        $id = $response->json('user.uid');
        if ((! is_string($id) && ! is_int($id)) || (string) $id === '') {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }
        $label = $response->json('user.display_name') ?: $response->json('user.login');

        return ['id' => (string) $id, 'label' => is_string($label) ? $label : null];
    }

    public function files(string $path): array
    {
        $response = $this->resource('/resources', ['path' => CloudHttp::validatePath($path), 'limit' => 1000]);
        $items = $response->json('_embedded.items') ?? [];
        if (! is_array($items)) {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }

        $files = [];
        foreach ($items as $item) {
            $type = is_string($item['type'] ?? null) ? CloudEntryType::tryFrom($item['type']) : null;
            if (! is_array($item) || ! is_string($item['name'] ?? null) || ! is_string($item['path'] ?? null) || $type === null) {
                throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
            }

            $files[] = ['name' => $item['name'], 'path' => $item['path'], 'type' => $type, 'size' => (int) ($item['size'] ?? 0)];
        }

        return $files;
    }

    private function path(string $path): string
    {
        return str_starts_with($path, 'disk:') ? 'disk:'.CloudHttp::validatePath(substr($path, 5)) : CloudHttp::validatePath($path);
    }

    public function download(string $path, string $destination): void
    {
        $response = $this->resource('/resources/download', ['path' => $this->path($path)]);
        $url = CloudHttp::yandexUrl((string) $response->json('href'));
        // Signed storage URLs do not receive the account Authorization header.
        $download = CloudHttp::client()->withOptions(CloudHttp::downloadOptions($destination))->get($url);
        CloudHttp::check($download, CloudProviderId::YANDEX);
    }

    public function upload(string $path, string $source): void
    {
        $response = $this->resource('/resources/upload', ['path' => $this->path($path), 'overwrite' => 'false']);
        $url = CloudHttp::yandexUrl((string) $response->json('href'));
        $stream = fopen($source, 'rb');
        if (! $stream) {
            throw new CloudFailure('ORIGINAL_UNAVAILABLE');
        }
        try {
            $upload = CloudHttp::client()->withBody(Utils::streamFor($stream), 'application/octet-stream')->put($url);
            CloudHttp::check($upload, CloudProviderId::YANDEX);
        } finally {
            fclose($stream);
        }
    }
}
