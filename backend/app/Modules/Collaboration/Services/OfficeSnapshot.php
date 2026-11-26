<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Services;

use App\Modules\Documents\DTO\IncomingFile;
use App\Modules\Documents\Models\Document;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Isolated snapshots prevent late callbacks from overwriting another save. */
final readonly class OfficeSnapshot
{
    public function __construct(private OfficeTokens $tokens, private SavedOfficeDraft $saved)
    {
    }

    public function capture(Document $document): IncomingFile
    {
        abort_unless(config('office.internal_url') && config('office.jwt_secret'), 503, 'Редактор не настроен.');
        $version = $document->publishedVersion;
        abort_unless($version?->isReady() && $document->desired_version_id === $version->id, 409, 'Дождитесь обработки текущей версии.');
        $draft = DB::table('office_drafts')->where('document_id', $document->id)->where('source_version_id', $version->id)->first();
        abort_unless($draft !== null, 409, 'Откройте документ в редакторе и сохраните изменения.');
        $nonce = (string) Str::uuid();
        $cacheKey = 'office-snapshot:'.$nonce;
        Cache::put($cacheKey, ['key' => $draft->editor_key], 90);
        $body = ['c' => 'forcesave', 'key' => $draft->editor_key, 'userdata' => $nonce];
        try {
            $response = Http::connectTimeout(3)->timeout(8)->withoutRedirecting()
                ->withToken($this->tokens->sign(['payload' => $body]))
                ->post(rtrim((string) config('office.internal_url'), '/').'/command?shardkey='.rawurlencode($draft->editor_key), $body + ['token' => $this->tokens->sign($body)]);
            abort_unless($response->successful(), 503, 'Редактор недоступен. Повторите попытку.');
            if ($response->json('error') === 1) {
                return $this->saved->file($document);
            }
            abort_if($response->json('error') === 4, 409, 'Новых изменений нет. Сохраните изменения в редакторе и повторите попытку.');
            abort_unless($response->json('error') === 0, 503, 'Не удалось получить файл из редактора. Повторите попытку.');
            $deadline = microtime(true) + 18;
            do {
                $snapshot = Cache::get($cacheKey);
                if (is_string($snapshot['path'] ?? null)) {
                    return new IncomingFile(Storage::disk('local')->path($snapshot['path']), $version->original_name);
                }
                usleep(150000);
            } while (microtime(true) < $deadline);
            abort(409, 'Редактор ещё сохраняет файл. Повторите создание версии через несколько секунд.');
        } catch (\Illuminate\Http\Client\ConnectionException) {
            abort(503, 'Не удалось связаться с редактором. Повторите попытку.');
        } finally {
            Cache::forget($cacheKey);
        }
    }
}
