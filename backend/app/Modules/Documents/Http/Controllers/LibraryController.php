<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Controllers;

use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\Actions\CreateFolderAction;
use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Http\Requests\CreateFolderRequest;
use App\Modules\Documents\Http\Requests\MoveDocumentRequest;
use App\Modules\Documents\Http\Resources\FolderResource;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\Folder;
use App\Modules\Identity\Enums\UserRole;
use Dedoc\Scramble\Attributes\Endpoint;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

final class LibraryController
{
    public function folders(Request $request): JsonResponse
    {
        $folders = Folder::query()
            ->where('owner_id', $request->user()->id)
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $folders]);
    }

    #[Endpoint(operationId: 'library.createFolder')]
    #[Response(404, description: 'The parent folder could not be found.')]
    public function create(CreateFolderRequest $request, CreateFolderAction $action): JsonResponse
    {
        return new FolderResource($action->handle(
            $request->user(),
            $request->validated('name'),
            $request->getParent(),
        ))->response()->setStatusCode(201);
    }

    public function removeFolder(Request $request, Folder $folder): JsonResponse
    {
        abort_unless($request->user()->role !== UserRole::OBSERVER && $folder->owner_id === $request->user()->id, 404);
        DB::transaction(function () use ($folder): void {
            Folder::query()->whereKey($folder->id)->lockForUpdate()->firstOrFail();
            abort_if(
                Folder::query()->where('parent_id', $folder->id)->exists()
                    || Document::query()->withTrashed()->where('folder_id', $folder->id)->exists(),
                409,
                'Сначала переместите документы и вложенные папки.',
            );
            $folder->delete();
        });

        return response()->json(['data' => null]);
    }

    public function move(MoveDocumentRequest $request, Document $document): JsonResponse
    {
        $folder = $request->getFolder();
        DB::transaction(function () use ($request, $document, $folder): void {
            $document->update(['folder_id' => $folder?->id]);
            AuditWriter::record($request->user()->id, 'document.moved', $document->id);
        });

        return response()->json(['data' => null]);
    }

    public function favorite(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::READ->value, $document);
        $data = $request->validate(['favorite' => 'required|boolean']);
        $key = ['document_id' => $document->id, 'user_id' => $request->user()->id];
        if ($data['favorite']) {
            DB::table('document_favorites')->insertOrIgnore($key);
        } else {
            DB::table('document_favorites')->where($key)->delete();
        }

        return response()->json(['data' => $data]);
    }

    public function tags(Request $request): JsonResponse
    {
        $visible = Document::query()->visibleTo($request->user())->select('documents.id');
        $tagIds = DB::table('document_tags')->select('tag_id')->whereIn('document_id', $visible);
        $tags = DB::table('tags')->whereIn('id', $tagIds)->orderBy('name')->get();

        return response()->json(['data' => $tags]);
    }

    public function setTags(Request $request, Document $document): JsonResponse
    {
        Gate::authorize(DocumentPermission::EDIT->value, $document);
        $data = $request->validate(['tags' => 'required|array|max:20', 'tags.*' => 'required|string|max:40']);
        DB::transaction(function () use ($request, $document, $data): void {
            DB::table('document_tags')->where('document_id', $document->id)->delete();
            foreach ($data['tags'] as $name) {
                $normalized = mb_strtolower($name);
                DB::table('tags')->insertOrIgnore([
                    'id' => (string) Str::uuid(),
                    'name' => $name,
                    'normalized_name' => $normalized,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $id = DB::table('tags')->where('normalized_name', $normalized)->value('id');
                DB::table('document_tags')->insertOrIgnore(['document_id' => $document->id, 'tag_id' => $id]);
            }
            AuditWriter::record($request->user()->id, 'document.tags.updated', $document->id);
        });

        return response()->json(['data' => null]);
    }
}
