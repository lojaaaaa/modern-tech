<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use App\Modules\Integrations\Enums\CloudEntryType;
use App\Modules\Integrations\Enums\CloudProviderId;
use Closure;
use Illuminate\Http\Client\Response;

final class GoogleDisk implements CloudProvider
{
    public const API_URL = 'https://www.googleapis.com/drive/v3';

    public function __construct(private string $token, private ?Closure $refreshToken = null)
    {
    }

    private function get(string $endpoint, array $query = []): Response
    {
        $response = CloudHttp::client()->withToken($this->token)->get(self::API_URL.$endpoint, $query);
        if ($response->status() === 401 && $this->refreshToken) {
            $this->token = ($this->refreshToken)($this->token);
            $response = CloudHttp::client()->withToken($this->token)->get(self::API_URL.$endpoint, $query);
        }
        CloudHttp::check($response, CloudProviderId::GOOGLE);
        return $response;
    }

    public function getAccount(): array
    {
        $user = $this->get('/about', ['fields' => 'user'])->json('user');
        abort_unless(is_array($user) && is_string($user['permissionId'] ?? null), 502);
        return ['id' => $user['permissionId'], 'label' => $user['emailAddress'] ?? $user['displayName'] ?? null];
    }

    private function folder(string $path): string
    {
        $folder = 'root';
        foreach (array_filter(explode('/', CloudHttp::validatePath($path))) as $name) {
            $escaped = str_replace(["\\", "'"], ["\\\\", "\\'"], $name);
            $items = $this->get('/files', ['q' => "'{$folder}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '{$escaped}'", 'fields' => 'files(id)', 'pageSize' => 2])->json('files');
            if (count($items ?? []) !== 1) {
                throw new CloudFailure('REMOTE_NOT_FOUND');
            }
            $folder = $items[0]['id'];
        }
        return $folder;
    }

    public function files(string $path): array
    {
        $folder = $this->folder($path);
        $files = [];
        $page = null;
        do {
            $response = $this->get('/files', array_filter(['q' => "'{$folder}' in parents and trashed = false", 'fields' => 'nextPageToken,files(id,name,mimeType,size)', 'pageSize' => 100, 'pageToken' => $page]));
            foreach ($response->json('files') ?? [] as $file) {
                $isFolder = $file['mimeType'] === 'application/vnd.google-apps.folder';
                // Native Google documents require conversion, so only binary files and folders are listed.
                if (!$isFolder && str_starts_with($file['mimeType'], 'application/vnd.google-apps.')) {
                    continue;
                }
                $files[] = ['name' => $file['name'], 'path' => $isFolder ? rtrim($path, '/').'/'.$file['name'] : '/@'.$file['id'], 'type' => $isFolder ? CloudEntryType::DIR : CloudEntryType::FILE, 'size' => (int) ($file['size'] ?? 0)];
            }
            $page = $response->json('nextPageToken');
        } while ($page && count($files) < 1000);
        return $files;
    }

    public function download(string $path, string $destination): void
    {
        if (!preg_match('~^/@([a-zA-Z0-9_-]+)$~D', $path, $match)) {
            throw new CloudFailure('INVALID_REMOTE_PATH');
        }
        $response = CloudHttp::client()->withToken($this->token)->withOptions(CloudHttp::downloadOptions($destination))->get(self::API_URL.'/files/'.$match[1], ['alt' => 'media']);
        if ($response->status() === 401 && $this->refreshToken) {
            $this->token = ($this->refreshToken)($this->token);
            // Truncate the failed response before retrying the binary download.
            file_put_contents($destination, '');
            $response = CloudHttp::client()->withToken($this->token)->withOptions(CloudHttp::downloadOptions($destination))->get(self::API_URL.'/files/'.$match[1], ['alt' => 'media']);
        }
        CloudHttp::check($response, CloudProviderId::GOOGLE);
    }

    public function upload(string $path, string $source): void
    {
        $path = CloudHttp::validatePath($path);
        $parent = $this->folder(dirname($path));
        $stream = fopen($source, 'rb');
        if (!$stream) {
            throw new CloudFailure('ORIGINAL_UNAVAILABLE');
        }
        try {
            $multipart = new \GuzzleHttp\Psr7\MultipartStream([
                ['name' => 'metadata', 'contents' => json_encode(['name' => basename($path), 'parents' => [$parent]], JSON_THROW_ON_ERROR), 'headers' => ['Content-Type' => 'application/json; charset=UTF-8']],
                ['name' => 'file', 'contents' => $stream, 'headers' => ['Content-Type' => 'application/octet-stream']],
            ]);
            $response = CloudHttp::client()->withToken($this->token)
                ->withBody($multipart, 'multipart/related; boundary='.$multipart->getBoundary())
                ->post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
            if ($response->status() === 401 && $this->refreshToken) {
                $this->token = ($this->refreshToken)($this->token);
                $multipart->rewind();
                $response = CloudHttp::client()->withToken($this->token)
                    ->withBody($multipart, 'multipart/related; boundary='.$multipart->getBoundary())
                    ->post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
            }
            CloudHttp::check($response, CloudProviderId::GOOGLE);
        } finally {
            fclose($stream);
        }
    }
}
