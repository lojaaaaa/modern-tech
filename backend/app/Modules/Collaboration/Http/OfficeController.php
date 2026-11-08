<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Http;

use App\Models\User;
use App\Modules\Collaboration\Services\OfficeTokens;
use App\Modules\Documents\Models\Document;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use ZipArchive;

final class OfficeController
{
    private const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    public function session(Request $request, Document $document, OfficeTokens $tokens): JsonResponse
    {
        $user = $request->user();
        Gate::authorize('read', $document);
        $edit = $user->can('edit', $document);
        $comment = $user->can('comment', $document);
        abort_unless($edit || $comment, 403, 'Рабочий черновик доступен участникам с правом изменения или комментирования.');
        foreach (['public_url', 'internal_url', 'app_internal_url', 'jwt_secret'] as $setting) {
            abort_unless(is_string(config('office.'.$setting)) && config('office.'.$setting) !== '', 503, 'Офисный редактор не настроен.');
        }
        $draft = DB::transaction(function () use ($document) {
            $locked = Document::whereKey($document->id)->lockForUpdate()->firstOrFail();
            $existing = DB::table('office_drafts')->where('document_id', $locked->id)->first();
            if ($existing) {
                return $existing;
            }
            $version = $locked->publishedVersion;
            abort_unless($version && $version->status === 'ready' && str_ends_with(strtolower($version->original_name), '.docx'), 409, 'Для редактирования нужен опубликованный DOCX.');
            $storage = Storage::disk('local');
            $key = 'office-drafts/'.Str::uuid().'.docx';
            abort_unless($storage->copy($version->storage_key, $key), 503, 'Не удалось создать черновик.');
            DB::table('office_drafts')->insert(['document_id' => $locked->id, 'source_version_id' => $version->id, 'storage_key' => $key, 'editor_key' => (string) Str::uuid(), 'created_at' => now(), 'updated_at' => now()]);

            return DB::table('office_drafts')->where('document_id', $locked->id)->first();
        });
        $capability = $tokens->sign(['purpose' => 'office-source', 'doc' => $document->id, 'key' => $draft->editor_key, 'user' => $user->id, 'exp' => time() + 28800]);
        $base = rtrim((string) config('office.app_internal_url'), '/');
        $config = [
            'documentType' => 'word', 'width' => '100%', 'height' => '100%',
            'document' => ['fileType' => 'docx', 'key' => $draft->editor_key, 'title' => $document->title.'.docx', 'url' => $base.'/api/v1/office/source/'.$capability, 'permissions' => ['edit' => $edit, 'comment' => $comment, 'download' => $user->can('export', $document)]],
            'editorConfig' => ['mode' => 'edit', 'lang' => 'ru', 'user' => ['id' => (string) $user->id, 'name' => $user->name], 'callbackUrl' => $base.'/api/v1/office/callback', 'coEditing' => ['mode' => 'fast', 'change' => true], 'customization' => ['autosave' => true, 'forcesave' => false]],
        ];
        $config['token'] = $tokens->sign($config);

        return response()->json(['documentServerUrl' => rtrim((string) config('office.public_url'), '/'), 'config' => $config]);
    }

    public function source(string $capability, OfficeTokens $tokens): BinaryFileResponse
    {
        abort_unless(config('office.jwt_secret'), 503);
        $payload = $tokens->verify($capability);
        abort_unless(($payload['purpose'] ?? null) === 'office-source' && is_string($payload['doc'] ?? null) && is_string($payload['key'] ?? null) && is_numeric($payload['user'] ?? null), 403);
        $document = Document::findOrFail($payload['doc']);
        $user = User::find($payload['user']);
        abort_unless($user && $user->active && ($user->can('edit', $document) || $user->can('comment', $document)), 403);
        $draft = DB::table('office_drafts')->where('document_id', $document->id)->where('editor_key', $payload['key'])->first();
        abort_unless($draft && Storage::disk('local')->exists($draft->storage_key), 404);

        return response()->file(Storage::disk('local')->path($draft->storage_key), ['Content-Type' => self::MIME, 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function callback(Request $request, OfficeTokens $tokens): JsonResponse
    {
        if (! config('office.jwt_secret')) {
            return response()->json(['error' => 1], 503);
        }
        $token = $request->input('token') ?: $request->bearerToken();
        $payload = is_string($token) ? $tokens->verify($token) : null;
        $payload = is_array($payload['payload'] ?? null) ? $payload['payload'] : $payload;
        if (! is_array($payload) || ! is_string($payload['key'] ?? null) || ! is_int($payload['status'] ?? null)) {
            return response()->json(['error' => 1], 403);
        }
        $draft = DB::table('office_drafts')->where('editor_key', $payload['key'])->first();
        if (! $draft) {
            return response()->json(['error' => 1]);
        }
        $status = $payload['status'];
        if ($status === 1) {
            return response()->json(['error' => 0]);
        }
        if ($status === 4) {
            DB::table('office_drafts')->where('editor_key', $draft->editor_key)->update(['editor_key' => (string) Str::uuid(), 'updated_at' => now()]);

            return response()->json(['error' => 0]);
        }
        // Force-save callbacks have no proven ordering; never overwrite with them.
        if ($status !== 2 || ! is_string($payload['url'] ?? null)) {
            return response()->json(['error' => 1]);
        }
        $url = parse_url($payload['url']);
        $public = parse_url((string) config('office.public_url'));
        $internal = parse_url((string) config('office.internal_url'));
        $origin = fn ($parts) => strtolower(($parts['scheme'] ?? '').'://'.($parts['host'] ?? '').':'.($parts['port'] ?? (($parts['scheme'] ?? '') === 'https' ? 443 : 80)));
        if (! is_array($url) || (isset($url['user']) || isset($url['pass'])) || ! str_starts_with($url['path'] ?? '', '/cache/') || ! in_array($origin($url), [$origin($public), $origin($internal)], true)) {
            return response()->json(['error' => 1]);
        }
        $target = rtrim((string) config('office.internal_url'), '/').$url['path'].(isset($url['query']) ? '?'.$url['query'] : '');
        $temporary = tempnam(sys_get_temp_dir(), 'office-');
        if ($temporary === false) {
            return response()->json(['error' => 1]);
        }
        try {
            $response = Http::timeout(30)->connectTimeout(5)->withoutRedirecting()->withOptions(['stream' => true])->get($target);
            if (! $response->successful()) {
                return response()->json(['error' => 1]);
            }
            $stream = $response->toPsrResponse()->getBody();
            $handle = fopen($temporary, 'wb');
            if (! $handle) {
                return response()->json(['error' => 1]);
            }
            $size = 0;
            try {
                while (! $stream->eof()) {
                    $chunk = $stream->read(65536);
                    $size += strlen($chunk);
                    if ($size > config('office.max_bytes') || fwrite($handle, $chunk) !== strlen($chunk)) {
                        return response()->json(['error' => 1]);
                    }
                }
            } finally {
                fclose($handle);
            }
            $zip = new ZipArchive;
            if ($zip->open($temporary, ZipArchive::CHECKCONS) !== true) {
                return response()->json(['error' => 1]);
            }
            $valid = $zip->locateName('[Content_Types].xml') !== false && $zip->locateName('word/document.xml') !== false;
            $zip->close();
            if (! $valid) {
                return response()->json(['error' => 1]);
            }
            $newPath = 'office-drafts/'.Str::uuid().'.docx';
            $input = fopen($temporary, 'rb');
            if (! $input) {
                return response()->json(['error' => 1]);
            }
            try {
                if (! Storage::disk('local')->put($newPath, $input)) {
                    return response()->json(['error' => 1]);
                }
            } finally {
                fclose($input);
            }
            $updated = DB::table('office_drafts')->where('document_id', $draft->document_id)->where('editor_key', $draft->editor_key)->update(['storage_key' => $newPath, 'editor_key' => (string) Str::uuid(), 'updated_at' => now()]);
            if (! $updated) {
                Storage::disk('local')->delete($newPath);
            }
            return response()->json(['error' => $updated ? 0 : 1]);
        } catch (\Throwable $error) {
            report($error);
            return response()->json(['error' => 1]);
        } finally {
            @unlink($temporary);
        }
    }
}
