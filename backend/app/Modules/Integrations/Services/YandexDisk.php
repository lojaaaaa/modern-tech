<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use Closure;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;

final class YandexDisk implements CloudProvider
{
    public function __construct(private string $token, private ?Closure $refreshToken = null) {}

    private function client(): PendingRequest
    {
        return CloudHttp::client()->withToken($this->token, 'OAuth')->baseUrl('https://cloud-api.yandex.net/v1/disk');
    }

    private function resource(string $path, array $parameters): Response
    {
        $response = $this->client()->get($path, $parameters);
        if ($response->status() === 401 && $this->refreshToken !== null) {
            $this->token = ($this->refreshToken)($this->token);
            $response = $this->client()->get($path, $parameters);
        }
        CloudHttp::check($response);

        return $response;
    }

    public function files(string $path): array
    {
        $response = $this->resource('/resources', ['path' => CloudHttp::validatePath($path), 'limit' => 1000]);

        return array_map(fn ($item) => ['name' => (string) $item['name'], 'path' => (string) $item['path'], 'type' => (string) $item['type'], 'size' => (int) ($item['size'] ?? 0)], $response->json('_embedded.items') ?? []);
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
        CloudHttp::check($download);
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
            CloudHttp::check($upload);
        } finally {
            fclose($stream);
        }
    }
}
