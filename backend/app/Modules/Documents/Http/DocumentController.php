<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Services\DocumentListing;
use App\Modules\Documents\Services\UploadDocument;
use App\Modules\Documents\Services\IncomingFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

final class DocumentController
{
    public function index(LibraryQueryRequest $request, DocumentListing $listing)
    {
        $data = $request->validated();

        return DocumentResource::collection($listing->query($request->user(), $data)->paginate($data['per_page'] ?? 12));
    }

    public function duplicates(UploadRequest $request)
    {
        $sha = hash_file('sha256', $request->file('file')->getPathname());
        $documents = Document::visibleTo($request->user())->whereHas('versions', fn ($v) => $v->where('sha256', $sha))->with(['owner', 'publishedVersion', 'desiredVersion'])->limit(10)->get();

        return DocumentResource::collection($documents);
    }

    public function store(UploadRequest $request, UploadDocument $upload)
    {
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 100, 422, 'Нужен Idempotency-Key длиной 8-100 символов.');
        $document = $upload->execute($request->user(), new IncomingFile($request->file('file')->getPathname(), $request->file('file')->getClientOriginalName()), $request->validated('title'), $key);

        return (new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion'])))->response()->setStatusCode(202);
    }

    public function show(Request $request, Document $document): DocumentResource
    {
        Gate::authorize('read', $document);

        return new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion']));
    }

    public function update(Request $request, Document $document): DocumentResource
    {
        Gate::authorize('edit', $document);
        $data = $request->validate(['title' => 'required|string|max:255', 'revision' => 'required|integer']);
        DB::transaction(function () use ($request, $document, $data): void {
            $locked = Document::whereKey($document->id)->lockForUpdate()->firstOrFail();
            abort_if($locked->revision !== $data['revision'], 409, 'Документ уже изменён. Обновите страницу.');
            $locked->update(['title' => $data['title'], 'revision' => $locked->revision + 1]);
            Audit::record($request->user()->id, 'document.updated', $locked->id);
        });

        return new DocumentResource($document->fresh(['owner', 'publishedVersion', 'desiredVersion']));
    }

    public function destroy(Request $request, Document $document): JsonResponse
    {
        Gate::authorize('manage', $document);
        DB::transaction(function () use ($document, $request): void {
            $document->update(['purge_after' => now()->addDays(30)]);
            $document->delete();
            Audit::record($request->user()->id, 'document.deleted', $document->id);
        });

        return response()->json(['data' => null]);
    }

    public function restore(Request $request, string $id): DocumentResource
    {
        $document = Document::onlyTrashed()->findOrFail($id);
        Gate::authorize('manage', $document);
        DB::transaction(function () use ($document, $request): void {
            $document->restore();
            $document->update(['purge_after' => null]);
            Audit::record($request->user()->id, 'document.restored', $document->id);
        });

        return new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion']));
    }

    public function versions(Request $request, Document $document): JsonResponse
    {
        Gate::authorize('read', $document);

        return response()->json(['data' => $document->versions()->orderByDesc('number')->get(['id', 'number', 'original_name', 'mime', 'size', 'status', 'error_code', 'created_at'])]);
    }

    public function addVersion(UploadRequest $request, Document $document, UploadDocument $upload)
    {
        Gate::authorize('edit', $document);
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 100, 422);

        return (new DocumentResource($upload->execute($request->user(), new IncomingFile($request->file('file')->getPathname(), $request->file('file')->getClientOriginalName()), null, $key, $document)->load(['owner', 'publishedVersion', 'desiredVersion'])))->response()->setStatusCode(202);
    }

    public function download(Request $request, DocumentVersion $version)
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize('export', $version->document);
        abort_unless($version->status === 'ready', 409, 'Файл ещё не прошёл обработку.');

        return Storage::disk('local')->download($version->storage_key, $version->original_name, ['X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    public function entities(Request $request, DocumentVersion $version): JsonResponse
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize('read', $version->document);

        // A ready candidate may never have been published. The current schema
        // only records the current published version, not publication history.
        abort_unless($version->status === 'ready' && $version->document->published_version_id === $version->id, 404);

        return response()->json(['data' => DB::table('document_entities')->where('version_id', $version->id)->orderBy('offset')->get()]);
    }

    public function text(Request $request, DocumentVersion $version): JsonResponse
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize('read', $version->document);

        return response()->json(['data' => ['text' => $version->extracted_text, 'status' => $version->status]]);
    }

    public function participants(Request $request, Document $document): JsonResponse
    {
        Gate::authorize('manage', $document);

        return response()->json(['data' => User::where('active', true)->where('id', '!=', $document->owner_id)->orderBy('name')->get(['id', 'name', 'role'])]);
    }

    public function grants(Request $request, Document $document): JsonResponse
    {
        Gate::authorize('manage', $document);

        return response()->json(['data' => $document->grants()->get()]);
    }

    public function setGrants(Request $request, Document $document): JsonResponse
    {
        Gate::authorize('manage', $document);
        $data = $request->validate(['grants' => 'required|array|max:100', 'grants.*.user_id' => 'required|integer|exists:users,id|distinct', 'grants.*.read' => 'required|boolean', 'grants.*.comment' => 'required|boolean', 'grants.*.edit' => 'required|boolean', 'grants.*.export' => 'required|boolean']);
        foreach ($data['grants'] as $grant) {
            $writer = $grant['comment'] || $grant['edit'] || $grant['export'];
            abort_if($writer && ! $grant['read'], 422, 'Дополнительные права требуют чтения.');
            abort_if($writer && User::findOrFail($grant['user_id'])->role === 'observer', 422, 'Наблюдатель может только читать.');
        }
        DB::transaction(function () use ($document, $data, $request): void {
            $document->grants()->delete();
            $document->grants()->createMany($data['grants']);
            Audit::record($request->user()->id, 'document.grants.updated', $document->id);
        });

        return $this->grants($request, $document);
    }
}
