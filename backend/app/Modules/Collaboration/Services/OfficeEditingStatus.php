<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

final readonly class OfficeEditingStatus
{
    public function __construct(private OfficeTokens $tokens)
    {
    }

    public function requireClosed(string $key): void
    {
        $url = config('office.internal_url');
        $message = 'Не удалось проверить состояние рабочего черновика. Повторите попытку позже.';
        abort_unless(is_string($url) && $url !== '' && config('office.jwt_secret'), 503, $message);

        $body = ['c' => 'info', 'key' => $key];
        try {
            $response = Http::connectTimeout(2)->timeout(3)->withoutRedirecting()
                ->withToken($this->tokens->sign(['payload' => $body]))
                ->post(
                    rtrim($url, '/') . '/command?shardkey=' . rawurlencode($key),
                    $body + ['token' => $this->tokens->sign($body)],
                );
        } catch (ConnectionException) {
            abort(503, $message);
        }

        $error = $response->json('error');
        abort_unless($response->successful() && in_array($error, [0, 1], true), 503, $message);
        abort_if($error === 0, 409, 'Закройте редактор и дождитесь сохранения рабочего черновика.');
    }
}
