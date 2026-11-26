<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Controllers;

use App\Modules\Documents\Actions\ResolvePreviewStatusAction;
use App\Modules\Documents\Http\Requests\PreviewRequest;
use App\Modules\Documents\Http\Resources\PreviewStatusResource;
use App\Modules\Documents\Models\DocumentVersion;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class PreviewController
{
    #[Response(409, description: 'The version is still being processed or could not be processed.')]
    public function show(
        PreviewRequest $request,
        DocumentVersion $version,
        ResolvePreviewStatusAction $action,
    ): PreviewStatusResource | StreamedResponse {
        if ($request->wantsPreviewStatus()) {
            return new PreviewStatusResource($action->handle($version));
        }

        $isNativePreview = $version->hasNativePreview() || in_array($version->getFileExtension(), ['md', 'csv', 'xlsx'], true);
        $key = $isNativePreview ? $version->storage_key : $version->preview_key;
        abort_if($key === null || $key === '', 404);

        $extension = $isNativePreview ? $version->getFileExtension() : 'pdf';

        return Storage::disk('local')->response($key, 'preview.' . $extension, [
            'Content-Type' => $isNativePreview ? $version->mime : 'application/pdf',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
            'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'self'",
        ], 'inline');
    }
}
