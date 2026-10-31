<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http;

use App\Modules\Access\Services\DocumentAccess;
use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\Folder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class LibraryController
{
    public function __construct(private DocumentAccess $access) {}

    public function folders(Request $request): JsonResponse
    {
        return response()->json(['data' => Folder::where('owner_id', $request->user()->id)->orderBy('name')->get()]);
    }

    public function createFolder(Request $request): JsonResponse
    {
        abort_if($request->user()->role === 'observer', 403);
        $data = $request->validate(['name' => 'required|string|max:120', 'parent_id' => 'nullable|uuid']);
        $parent = $data['parent_id'] ?? null;
        $depth = 1;
        while ($parent) {
            $folder = Folder::where('owner_id', $request->user()->id)->findOrFail($parent);
            $parent = $folder->parent_id;
            abort_if(++$depth > 5, 422, 'Максимальная вложенность — 5 папок.');
        }

        return response()->json(['data' => Folder::create($data + ['owner_id' => $request->user()->id])], 201);
    }

    public function removeFolder(Request $request, Folder $folder): JsonResponse
    {
        abort_unless($request->user()->role !== 'observer' && $folder->owner_id === $request->user()->id, 404);
        DB::transaction(function () use ($folder): void {
            Folder::whereKey($folder->id)->lockForUpdate()->firstOrFail();
            abort_if(Folder::where('parent_id', $folder->id)->exists() || Document::withTrashed()->where('folder_id', $folder->id)->exists(), 409, 'Сначала переместите документы и вложенные папки.');
            $folder->delete();
        });

        return response()->json(['data' => null]);
    }

    public function move(Request $request, Document $document): JsonResponse
    {
        $this->access->authorize($request->user(), $document, 'manage');
        $data = $request->validate(['folder_id' => 'nullable|uuid']);
        if ($data['folder_id'] ?? null) {
            abort_unless(Folder::whereKey($data['folder_id'])->where('owner_id', $document->owner_id)->exists(), 422);
        }
        DB::transaction(function () use ($request, $document, $data): void {
            $document->update(['folder_id' => $data['folder_id'] ?? null]);
            Audit::record($request->user()->id, 'document.moved', $document->id);
        });

        return response()->json(['data' => null]);
    }

    public function favorite(Request $request, Document $document): JsonResponse
    {
        $this->access->authorize($request->user(), $document, 'read');
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
        $visible = Document::visibleTo($request->user())->select('documents.id');

        return response()->json(['data' => DB::table('tags')->whereIn('id', DB::table('document_tags')->select('tag_id')->whereIn('document_id', $visible))->orderBy('name')->get()]);
    }

    public function setTags(Request $request, Document $document): JsonResponse
    {
        $this->access->authorize($request->user(), $document, 'edit');
        $data = $request->validate(['tags' => 'required|array|max:20', 'tags.*' => 'required|string|max:40']);
        DB::transaction(function () use ($request, $document, $data): void {
            DB::table('document_tags')->where('document_id', $document->id)->delete();
            foreach ($data['tags'] as $name) {
                $name = trim($name);
                abort_if($name === '', 422);
                $normalized = mb_strtolower($name);
                DB::table('tags')->insertOrIgnore(['id' => (string) Str::uuid(), 'name' => $name, 'normalized_name' => $normalized, 'created_at' => now(), 'updated_at' => now()]);
                $id = DB::table('tags')->where('normalized_name', $normalized)->value('id');
                DB::table('document_tags')->insertOrIgnore(['document_id' => $document->id, 'tag_id' => $id]);
            }
            Audit::record($request->user()->id, 'document.tags.updated', $document->id);
        });

        return response()->json(['data' => null]);
    }
}
