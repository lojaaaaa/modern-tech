<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Resources;

use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Document */
class DocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $term = $request->input('q');
        $isSearch = is_string($term) && $term !== '';
        $version = $isSearch ? $this->publishedVersion : ($this->publishedVersion ?? $this->desiredVersion);

        $snippet = null;
        $matched = $this->resource->getAttribute('matched_text');
        if (is_string($matched) && $isSearch) {
            $offset = mb_stripos($matched, $term);
            $snippet = mb_substr($matched, max(0, ($offset === false ? 0 : $offset) - 80), 240);
        }

        $user = $request->user();

        return [
            'snippet' => $snippet,
            'id' => $this->id,
            'title' => $this->title,
            'owner' => $this->owner?->only(['id', 'name', 'email']),
            'revision' => $this->revision,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'deleted_at' => $this->deleted_at,
            'version' => $version?->only(['id', 'number', 'original_name', 'mime', 'size', 'status', 'error_code']),
            'processing_status' => $isSearch ? $this->publishedVersion?->status : $this->desiredVersion?->status,
            'permissions' => [
                'read' => $user->can(DocumentPermission::READ->value, $this->resource),
                'comment' => $user->can(DocumentPermission::COMMENT->value, $this->resource),
                'edit' => $user->can(DocumentPermission::EDIT->value, $this->resource),
                'export' => $user->can(DocumentPermission::EXPORT->value, $this->resource),
                'manage' => $user->can(DocumentPermission::MANAGE->value, $this->resource),
            ],
        ];
    }
}
