<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http;

use App\Modules\Audit\Services\Audit;
use App\Modules\Documents\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

final class BatchController
{
    public function store(Request $request)
    {
        $data = $request->validate(['ids' => 'required|array|min:1|max:100', 'ids.*' => 'required|uuid|distinct', 'action' => ['required', Rule::in(['trash', 'restore', 'favorite'])]]);
        DB::transaction(function () use ($request, $data) {
            $query = Document::query();
            if ($data['action'] === 'restore') {
                $query->onlyTrashed();
            }
            $documents = $query->whereIn('id', $data['ids'])->orderBy('id')->lockForUpdate()->get();
            abort_unless($documents->count() === count($data['ids']), 404);
            foreach ($documents as $document) {
                Gate::authorize($data['action'] === 'favorite' ? 'read' : 'manage', $document);
            }
            foreach ($documents as $document) {
                if ($data['action'] === 'trash') {
                    $document->update(['purge_after' => now()->addDays(30)]);
                    $document->delete();
                } elseif ($data['action'] === 'restore') {
                    $document->restore();
                    $document->update(['purge_after' => null]);
                } else {
                    DB::table('document_favorites')->insertOrIgnore(['document_id' => $document->id, 'user_id' => $request->user()->id]);
                }
                Audit::record($request->user()->id, 'document.batch.'.$data['action'], $document->id);
            }
        });

        return response()->json(['data' => ['count' => count($data['ids'])]]);
    }
}
