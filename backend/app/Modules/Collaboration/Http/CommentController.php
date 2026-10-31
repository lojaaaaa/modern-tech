<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Http;

use App\Models\User;
use App\Modules\Access\Services\DocumentAccess;
use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\Document;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class CommentController
{
    public function __construct(private DocumentAccess $access) {}

    public function index(Request $request, Document $document): JsonResponse
    {
        $this->access->authorize($request->user(), $document, 'read');
        $comments = DB::table('document_comments')->join('users', 'users.id', '=', 'document_comments.author_id')->where('document_id', $document->id)->orderBy('document_comments.created_at')->get(['document_comments.*', 'users.name as author_name']);
        $comments->each(function ($c): void {
            if ($c->deleted_at) {
                $c->body = 'Комментарий удалён';
                $c->anchor_quote = null;
                $c->anchor_start = null;
                $c->anchor_end = null;
            }
        });

        return response()->json(['data' => $comments]);
    }

    public function store(Request $request, Document $document): JsonResponse
    {
        $this->access->authorize($request->user(), $document, 'comment');
        $data = $request->validate(['body' => 'required|string|max:5000', 'version_id' => 'required|uuid', 'parent_id' => 'nullable|uuid', 'anchor_start' => 'nullable|integer|min:0|required_with:anchor_end,anchor_quote', 'anchor_end' => 'nullable|integer|gt:anchor_start|required_with:anchor_start,anchor_quote', 'anchor_quote' => 'nullable|string|max:2000|required_with:anchor_start,anchor_end']);
        $version = $document->versions()->whereKey($data['version_id'])->first();
        abort_unless($version !== null, 422);
        if (isset($data['anchor_start'])) {
            abort_unless($version->status === 'ready' && $version->extracted_text !== null, 409);
            // Browser Range offsets use UTF-16 code units, including surrogate pairs.
            $utf16 = mb_convert_encoding($version->extracted_text, 'UTF-16LE', 'UTF-8');
            abort_unless($data['anchor_end'] <= strlen($utf16) / 2, 422, 'Фрагмент вне текста версии.');
            $quote = mb_convert_encoding(substr($utf16, $data['anchor_start'] * 2, ($data['anchor_end'] - $data['anchor_start']) * 2), 'UTF-8', 'UTF-16LE');
            abort_unless($quote === $data['anchor_quote'], 422, 'Фрагмент не совпадает с текстом версии.');
        }
        if ($data['parent_id'] ?? null) {
            abort_unless(DB::table('document_comments')->where('id', $data['parent_id'])->where('document_id', $document->id)->whereNull('parent_id')->exists(), 422);
        }
        $key = $request->header('Idempotency-Key');
        abort_if($key !== null && (strlen($key) < 8 || strlen($key) > 100), 422);
        $scope = 'comment:'.$document->id;
        $hash = hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));
        $id = DB::transaction(function () use ($data, $document, $request, $key, $scope, $hash): string {
            User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            if ($key !== null) {
                $prior = DB::table('idempotency_records')->where(['user_id' => $request->user()->id, 'scope' => $scope, 'key' => $key])->first();
                if ($prior) {
                    abort_if($prior->request_hash !== $hash, 409, 'Ключ уже использован для другого комментария.');

                    return $prior->resource_id;
                }
            }
            $id = (string) Str::uuid();
            DB::table('document_comments')->insert(['id' => $id, 'document_id' => $document->id, 'author_id' => $request->user()->id, 'version_id' => $data['version_id'], 'body' => $data['body'], 'anchor_start' => $data['anchor_start'] ?? null, 'anchor_end' => $data['anchor_end'] ?? null, 'anchor_quote' => $data['anchor_quote'] ?? null, 'parent_id' => $data['parent_id'] ?? null, 'created_at' => now(), 'updated_at' => now()]);
            Audit::record($request->user()->id, 'comment.created', $id);
            if ($key !== null) {
                DB::table('idempotency_records')->insert(['user_id' => $request->user()->id, 'scope' => $scope, 'key' => $key, 'request_hash' => $hash, 'resource_id' => $id, 'created_at' => now(), 'updated_at' => now()]);
            }

            return $id;
        });

        return response()->json(['data' => DB::table('document_comments')->find($id)], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['body' => 'required|string|max:5000', 'revision' => 'required|integer']);
        DB::transaction(function () use ($request, $id, $data): void {
            $comment = DB::table('document_comments')->where('id', $id)->whereNull('deleted_at')->lockForUpdate()->first();
            abort_unless($comment !== null, 404);
            $document = Document::findOrFail($comment->document_id);
            $this->access->authorize($request->user(), $document, 'comment');
            abort_unless($comment->author_id === $request->user()->id, 403);
            abort_unless($comment->revision === $data['revision'], 409);
            DB::table('document_comments')->where('id', $id)->update(['body' => $data['body'], 'revision' => $comment->revision + 1, 'updated_at' => now()]);
            Audit::record($request->user()->id, 'comment.updated', $id);
        });

        return response()->json(['data' => DB::table('document_comments')->find($id)]);
    }

    public function resolve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['resolved' => 'required|boolean']);
        DB::transaction(function () use ($request, $id, $data): void {
            $comment = DB::table('document_comments')->where('id', $id)->whereNull('deleted_at')->lockForUpdate()->first();
            abort_unless($comment !== null, 404);
            $document = Document::findOrFail($comment->document_id);
            $this->access->authorize($request->user(), $document, 'comment');
            abort_unless((int) $comment->author_id === $request->user()->id || $this->access->allows($request->user(), $document, 'manage'), 403);
            DB::table('document_comments')->where('id', $id)->update(['resolved_at' => $data['resolved'] ? now() : null, 'updated_at' => now()]);
            Audit::record($request->user()->id, $data['resolved'] ? 'comment.resolved' : 'comment.reopened', $id);
        });

        return response()->json(['data' => DB::table('document_comments')->find($id)]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $comment = DB::table('document_comments')->where('id', $id)->whereNull('deleted_at')->first();
        abort_unless($comment !== null, 404);
        $this->access->authorize($request->user(), Document::findOrFail($comment->document_id), 'comment');
        abort_unless($comment->author_id === $request->user()->id || $request->user()->isAdministrator(), 403);
        DB::transaction(function () use ($request, $id): void {
            DB::table('document_comments')->where('id', $id)->update(['deleted_at' => now()]);
            Audit::record($request->user()->id, 'comment.deleted', $id);
        });

        return response()->json(['data' => null]);
    }
}
