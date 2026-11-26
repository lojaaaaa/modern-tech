<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/** A failed disconnect must never be reported as a successful permission revocation. */
final readonly class OfficeAccess
{
    public function __construct(private OfficeTokens $tokens)
    {
    }

    public function revokeDocument(string $documentId, array $users): void
    {
        if ($users === []) {
            return;
        }
        foreach (DB::table('office_drafts')->where('document_id', $documentId)->pluck('editor_key') as $key) {
            $this->drop($key, $users);
        }
    }

    public function revokeUser(int $userId): void
    {
        foreach (DB::table('office_drafts')->pluck('editor_key') as $key) {
            $this->drop($key, [$userId]);
        }
    }

    private function drop(string $key, array $users): void
    {
        $message = 'Не удалось отключить офисную сессию. Изменение прав не сохранено. Повторите позже.';
        abort_unless(config('office.internal_url') && config('office.jwt_secret'), 503, $message);
        $body = ['c' => 'drop', 'key' => $key, 'users' => array_map('strval', $users)];
        try {
            $response = Http::connectTimeout(2)->timeout(5)->withoutRedirecting()
                ->withToken($this->tokens->sign(['payload' => $body]))
                ->post(rtrim(config('office.internal_url'), '/').'/command?shardkey='.rawurlencode($key), $body + ['token' => $this->tokens->sign($body)]);
        } catch (\Illuminate\Http\Client\ConnectionException) {
            abort(503, $message);
        }
        abort_unless($response->successful() && in_array($response->json('error'), [0, 1], true), 503, $message);
    }
}
