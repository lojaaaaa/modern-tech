<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Controllers;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\Actions\RenameDocumentAction;
use App\Modules\Documents\Actions\ReplaceDocumentGrantsAction;
use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Http\Requests\LibraryQueryRequest;
use App\Modules\Documents\Http\Requests\RenameDocumentRequest;
use App\Modules\Documents\Http\Requests\ReplaceDocumentGrantsRequest;
use App\Modules\Documents\Http\Requests\RestoreDocumentRequest;
use App\Modules\Documents\Http\Requests\UploadRequest;
use App\Modules\Documents\Http\Resources\DocumentResource;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Documents\Queries\ListDocumentsQuery;
use App\Modules\Documents\Services\UploadDocument;
use Dedoc\Scramble\Attributes\HeaderParameter;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

final class DocumentController
{
    public function index(LibraryQueryRequest $request, ListDocumentsQuery $list)
    {
        return DocumentResource::collection($list->handle($request->user(), $request->getData()));
    }

    public function duplicates(UploadRequest $request)
    {
        $incoming = $request->getIncomingFile();

        return DocumentResource::collection(Document::findDuplicates($request->user(), $incoming->sha256()));
    }

    #[HeaderParameter(
        UploadRequest::IDEMPOTENCY_HEADER,
        'An idempotency key of 8–100 bytes.',
        required: true,
        type: 'string',
    )]
    public function store(UploadRequest $request, UploadDocument $upload)
    {
        $document = $upload->execute(
            $request->user(),
            $request->getIncomingFile(),
            $request->validated('title'),
            $request->getIdempotencyKey(),
        );

        return (new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion'])))
            ->response()
            ->setStatusCode(202);
    }

    public function show(Request $request, Document $document): DocumentResource
    {
        Gate::authorize(DocumentPermission::READ->value, $document);

        return new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion']));
    }

    #[Response(409, description: 'The submitted revision no longer matches the document.')]
    public function update(
        RenameDocumentRequest $request,
        Document $document,
        RenameDocumentAction $action,
    ): DocumentResource {
        $document = $action->handle($request->user(), $document, $request->getData());

        return new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion']));
    }

    public function destroy(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::MANAGE->value, $document);
        DB::transaction(function () use ($document, $request): void {
            $document->update(['purge_after' => now()->addDays(30)]);
            $document->delete();
            AuditWriter::record($request->user()->id, 'document.deleted', $document->id);
        });

        return response()->json(['data' => null]);
    }

    public function restore(RestoreDocumentRequest $request): DocumentResource
    {
        $document = $request->getDocument();
        Gate::authorize(DocumentPermission::MANAGE->value, $document);
        DB::transaction(function () use ($document, $request): void {
            $document->restore();
            $document->update(['purge_after' => null]);
            AuditWriter::record($request->user()->id, 'document.restored', $document->id);
        });

        return new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion']));
    }

    public function versions(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::READ->value, $document);

        $versions = $document->versions()
            ->orderByDesc('number')
            ->get(['id', 'number', 'original_name', 'mime', 'size', 'status', 'error_code', 'created_at']);

        return response()->json(['data' => $versions]);
    }

    #[HeaderParameter(
        UploadRequest::IDEMPOTENCY_HEADER,
        'An idempotency key of 8–100 bytes.',
        required: true,
        type: 'string',
    )]
    public function addVersion(UploadRequest $request, Document $document, UploadDocument $upload)
    {
        $document = $upload->execute(
            $request->user(),
            $request->getIncomingFile(),
            null,
            $request->getIdempotencyKey(),
            $document,
        );

        return (new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion'])))
            ->response()
            ->setStatusCode(202);
    }

    public function download(Request $request, DocumentVersion $version)
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize(DocumentPermission::EXPORT->value, $version->document);
        abort_unless($version->isReady(), 409, 'Файл ещё не прошёл обработку.');

        return Storage::disk('local')->download($version->storage_key, $version->original_name, [
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ]);
    }

    public function entities(Request $request, DocumentVersion $version): JsonResponse
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize(DocumentPermission::READ->value, $version->document);

        // A ready candidate may never have been published. The current schema
        // only records the current published version, not publication history.
        abort_unless($version->isReady() && $version->document->published_version_id === $version->id, 404);

        $entities = DB::table('document_entities')->where('version_id', $version->id)->orderBy('offset')->get();

        return response()->json(['data' => $entities]);
    }

    public function text(Request $request, DocumentVersion $version): JsonResponse
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize(DocumentPermission::READ->value, $version->document);

        return response()->json(['data' => ['text' => $version->extracted_text, 'status' => $version->status]]);
    }

    public function participants(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::MANAGE->value, $document);

        $participants = User::query()
            ->where('active', true)
            ->where('id', '!=', $document->owner_id)
            ->orderBy('name')
            ->get(['id', 'name', 'role']);

        return response()->json(['data' => $participants]);
    }

    public function grants(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::MANAGE->value, $document);

        return response()->json(['data' => $document->grants()->get()]);
    }

    #[Response(type: 'array{data: list<\App\Modules\Documents\Models\DocumentGrant>}')]
    public function setGrants(
        ReplaceDocumentGrantsRequest $request,
        Document $document,
        ReplaceDocumentGrantsAction $action,
    ): JsonResponse {
        $grants = $action->handle($request->user(), $document, $request->getData());

        return response()->json(['data' => $grants]);
    }
}
