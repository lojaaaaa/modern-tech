<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Controllers;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Collaboration\Services\SavedOfficeDraft;
use App\Modules\Documents\Actions\PublishOfficeDraftAction;
use App\Modules\Documents\Actions\PurgeDocumentAction;
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
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Documents\Queries\ListDocumentsQuery;
use App\Modules\Documents\Services\UploadDocument;
use Dedoc\Scramble\Attributes\HeaderParameter;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

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
        $document = DB::transaction(function () use ($request): Document {
            $document = $request->getDocument();
            Gate::authorize(DocumentPermission::MANAGE->value, $document);
            $document->restore();
            $document->update(['purge_after' => null]);
            AuditWriter::record($request->user()->id, 'document.restored', $document->id);

            return $document;
        });

        return new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion']));
    }

    public function purge(Request $request, string $id, PurgeDocumentAction $action): JsonResponse
    {
        $action->handle($request->user(), $id);

        return response()->json(['data' => null]);
    }

    public function versions(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::READ->value, $document);

        $versions = $document->versions()
            ->when(
                $request->user()->cannot(DocumentPermission::EDIT->value, $document),
                fn ($versions) => $versions->where('document_versions.id', $document->published_version_id),
            )
            ->orderByDesc('number')
            ->leftJoin('users', 'users.id', '=', 'document_versions.creator_id')
            ->get([
                'document_versions.id', 'number', 'original_name', 'mime', 'size', 'status', 'error_code',
                'document_versions.created_at', 'users.name as creator_name',
            ]);

        return response()->json(['data' => $versions]);
    }

    public function draftStatus(Document $document, SavedOfficeDraft $draft): JsonResponse
    {
        Gate::authorize(DocumentPermission::MANAGE->value, $document);
        try {
            DB::transaction(function () use ($document, $draft): void {
                $draft->file(Document::query()->lockForUpdate()->findOrFail($document->id));
            });

            return response()->json(['data' => ['available' => true, 'reason' => null]]);
        } catch (HttpExceptionInterface $error) {
            if (! in_array($error->getStatusCode(), [409, 503], true)) {
                throw $error;
            }

            return response()->json(['data' => ['available' => false, 'reason' => $error->getMessage()]]);
        }
    }

    #[HeaderParameter(UploadRequest::IDEMPOTENCY_HEADER, 'An idempotency key of 8–94 bytes.', required: true, type: 'string')]
    public function publishDraft(Request $request, Document $document, PublishOfficeDraftAction $action)
    {
        Gate::authorize(DocumentPermission::MANAGE->value, $document);
        $key = $request->header(UploadRequest::IDEMPOTENCY_HEADER);
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 94, 422, __('documents.invalid_idempotency_key'));
        $document = $action->handle($request->user(), $document, $key);

        return (new DocumentResource($document->load(['owner', 'publishedVersion', 'desiredVersion'])))
            ->response()
            ->setStatusCode(202);
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

    public function download(Request $request, DocumentVersion $version, DocumentPolicy $policy)
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize(DocumentPermission::EXPORT->value, $version->document);
        $policy->readVersion($request->user(), $version)->authorize();
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

        abort_unless($version->isReady() && $version->document->published_version_id === $version->id, 404);

        $entities = DB::table('document_entities')->where('version_id', $version->id)->orderBy('offset')->get();

        return response()->json(['data' => $entities]);
    }

    public function text(Request $request, DocumentVersion $version, DocumentPolicy $policy): JsonResponse
    {
        $policy->readVersion($request->user(), $version)->authorize();

        return response()->json(['data' => ['text' => $version->extracted_text, 'status' => $version->status]]);
    }

    public function participants(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::MANAGE->value, $document);

        $search = $request->validate(['search' => ['nullable', 'string', 'max:120'], 'granted' => ['sometimes', 'boolean']])['search'] ?? '';
        $participants = User::query()
            ->when($request->boolean('granted'), fn ($query) => $query->whereIn('id', $document->grants()->select('user_id')), fn ($query) => $query->where('active', true))
            ->where('id', '!=', $document->owner_id)
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query->whereLike('name', '%'.$search.'%')->orWhereLike('email', '%'.$search.'%')))
            ->orderBy('name')
            ->limit($request->has('search') ? 30 : 100)
            ->get(['id', 'name', 'email', 'role']);

        return response()->json(['data' => $participants]);
    }

    #[Response(type: 'array{data: list<\App\Modules\Documents\Models\DocumentGrant>, meta: array{revision: int, owner_permissions: array{read: bool, comment: bool, edit: bool, export: bool}}}')]
    public function grants(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::MANAGE->value, $document);

        return DB::transaction(function () use ($document): JsonResponse {
            $document = Document::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            Gate::authorize(DocumentPermission::MANAGE->value, $document);
            $owner = $document->owner;
            $permissions = [];
            foreach (['read', 'comment', 'edit', 'export'] as $right) {
                $permissions[$right] = $owner?->can($right, $document) ?? false;
            }
            return response()->json(['data' => $document->grants()->get(), 'meta' => ['revision' => $document->revision, 'owner_permissions' => $permissions]]);
        });
    }

    #[Response(type: 'array{data: list<\App\Modules\Documents\Models\DocumentGrant>, meta: array{revision: int, owner_permissions: array{read: bool, comment: bool, edit: bool, export: bool}}}')]
    public function setGrants(
        ReplaceDocumentGrantsRequest $request,
        Document $document,
        ReplaceDocumentGrantsAction $action,
    ): JsonResponse {
        $action->handle($request->user(), $document, $request->getData());

        return $this->grants($request, $document);
    }
}
