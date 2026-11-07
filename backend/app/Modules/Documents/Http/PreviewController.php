<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http;

use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Jobs\GeneratePreview;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

final class PreviewController
{
    public function show(Request $request, DocumentVersion $version)
    {
        abort_unless($version->document !== null, 404);
        Gate::authorize('read', $version->document);
        abort_unless($version->status === 'ready', 409);
        $extension = strtolower(pathinfo($version->original_name, PATHINFO_EXTENSION));
        $native = in_array($version->mime, ['application/pdf', 'image/png', 'image/jpeg'], true);
        $office = in_array($extension, ['docx', 'xlsx', 'pptx'], true);
        if ($request->boolean('status')) {
            if (! $native && $office && ! $version->preview_key && ! Cache::has('preview-error:'.$version->id)) {
                if (Cache::add('preview-request:'.$version->id, true, 240)) {
                    GeneratePreview::dispatch($version->id);
                }
            }

            return response()->json(['data' => ['kind' => $native ? (str_starts_with($version->mime, 'image/') ? 'image' : 'pdf') : ($office ? 'pdf' : 'text'), 'status' => $native || $version->preview_key || ! $office ? 'ready' : (Cache::has('preview-error:'.$version->id) ? 'failed' : 'pending')]]);
        }
        abort_unless($native || $version->preview_key, 404);
        $key = $native ? $version->storage_key : $version->preview_key;

        return Storage::disk('local')->response($key, 'preview.'.($native ? $extension : 'pdf'), ['Content-Type' => $native ? $version->mime : 'application/pdf', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store', 'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'self'"], 'inline');
    }
}
