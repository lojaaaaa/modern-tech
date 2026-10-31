<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Services;

use GuzzleHttp\Psr7\Utils;
use Illuminate\Http\Client\PendingRequest;

final class MailCloud implements CloudProvider
{
    public function __construct(private string $email, private string $password) {}

    private function client(): PendingRequest
    {
        return CloudHttp::client()->withBasicAuth($this->email, $this->password);
    }

    private function url(string $path): string
    {
        return 'https://webdav.cloud.mail.ru'.implode('/', array_map('rawurlencode', explode('/', CloudHttp::validatePath($path))));
    }

    public function files(string $path): array
    {
        $body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';
        $response = $this->client()->withHeaders(['Depth' => '1'])->withBody($body, 'application/xml')->send('PROPFIND', $this->url($path));
        CloudHttp::check($response);
        $xml = $response->body();
        if (strlen($xml) > 2_000_000 || stripos($xml, '<!DOCTYPE') !== false || stripos($xml, '<!ENTITY') !== false) {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }
        $prior = libxml_use_internal_errors(true);
        try {
            $doc = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($prior);
        }
        if ($doc === false) {
            throw new CloudFailure('INVALID_PROVIDER_RESPONSE');
        }$doc->registerXPathNamespace('d', 'DAV:');
        $files = [];
        foreach ($doc->xpath('//d:response') ?: [] as $item) {
            $item->registerXPathNamespace('d', 'DAV:');
            $href = rawurldecode((string) ($item->xpath('d:href')[0] ?? ''));
            $remote = parse_url($href, PHP_URL_PATH) ?: $href;
            if (rtrim($remote, '/') === rtrim(CloudHttp::validatePath($path), '/')) {
                continue;
            }$files[] = ['name' => basename(rtrim($remote, '/')), 'path' => $remote, 'type' => ($item->xpath('d:propstat/d:prop/d:resourcetype/d:collection') ?: []) ? 'dir' : 'file', 'size' => (int) (string) ($item->xpath('d:propstat/d:prop/d:getcontentlength')[0] ?? '0')];
        }

        return $files;
    }

    public function download(string $path, string $destination): void
    {
        CloudHttp::check($this->client()->withOptions(CloudHttp::downloadOptions($destination))->get($this->url($path)));
    }

    public function upload(string $path, string $source): void
    {
        $stream = fopen($source, 'rb');
        if (! $stream) {
            throw new CloudFailure('ORIGINAL_UNAVAILABLE');
        }
        try {
            CloudHttp::check($this->client()->withHeaders(['If-None-Match' => '*'])->withBody(Utils::streamFor($stream), 'application/octet-stream')->put($this->url($path)));
        } finally {
            fclose($stream);
        }
    }
}
