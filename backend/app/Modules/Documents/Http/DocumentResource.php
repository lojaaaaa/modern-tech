<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http;

use App\Modules\Access\Services\DocumentAccess;
use App\Modules\Documents\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Document */
class DocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $access = app(DocumentAccess::class);
        $version = $this->publishedVersion ?? $this->desiredVersion;

        $snippet = null;
        $matched = $this->resource->getAttribute('matched_text');
        if (is_string($matched)) {
            $term = trim((string) $request->input('q', ''));
            $offset = mb_stripos($matched, $term);
            $snippet = mb_substr($matched, max(0, ($offset === false ? 0 : $offset) - 80), 240);
        }

        return ['snippet' => $snippet, 'id' => $this->id, 'title' => $this->title, 'owner' => $this->owner?->only(['id', 'name', 'email']), 'revision' => $this->revision, 'created_at' => $this->created_at, 'updated_at' => $this->updated_at, 'deleted_at' => $this->deleted_at, 'version' => $version?->only(['id', 'number', 'original_name', 'mime', 'size', 'status', 'error_code']), 'processing_status' => $this->desiredVersion?->status, 'permissions' => ['read' => (bool) $access->allows($request->user(), $this->resource, 'read'), 'comment' => (bool) $access->allows($request->user(), $this->resource, 'comment'), 'edit' => (bool) $access->allows($request->user(), $this->resource, 'edit'), 'export' => (bool) $access->allows($request->user(), $this->resource, 'export'), 'manage' => (bool) $access->allows($request->user(), $this->resource, 'manage')]];
    }
}
