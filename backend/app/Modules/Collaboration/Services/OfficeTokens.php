<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Services;

final class OfficeTokens
{
    private function encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    public function sign(array $payload): string
    {
        $data = $this->encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_THROW_ON_ERROR)).'.'.$this->encode(json_encode($payload, JSON_THROW_ON_ERROR));

        return $data.'.'.$this->encode(hash_hmac('sha256', $data, (string) config('office.jwt_secret'), true));
    }

    public function verify(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3 || ! hash_equals($this->encode(hash_hmac('sha256', $parts[0].'.'.$parts[1], (string) config('office.jwt_secret'), true)), $parts[2])) {
            return null;
        }
        $header = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/'), true), true);
        $payload = json_decode((string) base64_decode(strtr($parts[1], '-_', '+/'), true), true);
        if (($header['alg'] ?? null) !== 'HS256' || ! is_array($payload) || (isset($payload['exp']) && (! is_numeric($payload['exp']) || $payload['exp'] <= time()))) {
            return null;
        }

        return $payload;
    }
}
