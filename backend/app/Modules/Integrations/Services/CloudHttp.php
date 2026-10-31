<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

final class CloudHttp
{
    public static function client(): PendingRequest
    {
        return Http::connectTimeout(10)->timeout(180)->withOptions(['allow_redirects' => false]);
    }

    public static function check(Response $response): void
    {
        if ($response->successful()) {
            return;
        }
        throw new CloudFailure(match ($response->status()) {
            401,403 => 'AUTHORIZATION_REQUIRED',404 => 'REMOTE_NOT_FOUND',409,412 => 'REMOTE_CONFLICT',413 => 'FILE_TOO_LARGE',429 => 'RATE_LIMITED',507 => 'QUOTA_EXCEEDED',default => 'PROVIDER_ERROR'
        });
    }

    /** @return array<string,mixed> */
    public static function downloadOptions(string $destination): array
    {
        return ['sink' => $destination, 'progress' => function ($total, $downloaded): void {
            if ($total > 52_428_800 || $downloaded > 52_428_800) {
                throw new CloudFailure('FILE_TOO_LARGE');
            }
        }];
    }

    public static function validatePath(string $path): string
    {
        if (str_starts_with($path, 'disk:')) {
            $path = substr($path, 5);
        }
        if (strlen($path) > 2048 || str_contains($path, "\0") || preg_match('~(^|/)\.\.(/|$)~', $path)) {
            throw new CloudFailure('INVALID_REMOTE_PATH');
        }

        return '/'.ltrim($path, '/');
    }

    public static function yandexUrl(string $url): string
    {
        $parts = parse_url($url);
        $host = strtolower($parts['host'] ?? '');
        if (($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || ! (str_ends_with($host, '.yandex.net') || str_ends_with($host, '.yandex.ru'))) {
            throw new CloudFailure('UNSAFE_PROVIDER_URL');
        }

        return $url;
    }
}
