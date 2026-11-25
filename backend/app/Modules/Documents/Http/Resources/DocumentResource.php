<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Resources;

use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Queries\SearchDocumentsQuery;
use App\Modules\Processing\Services\SearchIndexer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Document */
class DocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $isSearch = array_key_exists('matched_title', $this->resource->getAttributes());
        $version = $this->publishedVersion ?? $this->desiredVersion;
        $match = $isSearch ? $this->contentMatch() : null;
        $user = $request->user();

        return [
            'snippet' => $match['snippet'] ?? null,
            'matched_title' => $isSearch ? (bool) $this->resource->getAttribute('matched_title') : null,
            'search_match' => $match === null ? null : [
                'version_id' => (string) $this->published_version_id,
                'start' => (int) $match['start'],
                'quote' => (string) $match['quote'],
                'snippet_offset' => (int) $match['offset'],
            ],
            'id' => $this->id,
            'title' => $this->title,
            'owner' => $this->owner?->only(['id', 'name', 'email']),
            'revision' => $this->revision,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'deleted_at' => $this->deleted_at,
            'version' => $version?->only(['id', 'number', 'original_name', 'mime', 'size', 'status', 'error_code']),
            'processing_status' => $isSearch ? $version?->status : $this->desiredVersion?->status,
            'permissions' => [
                'read' => $user->can(DocumentPermission::READ->value, $this->resource),
                'comment' => $user->can(DocumentPermission::COMMENT->value, $this->resource),
                'edit' => $user->can(DocumentPermission::EDIT->value, $this->resource),
                'export' => $user->can(DocumentPermission::EXPORT->value, $this->resource),
                'manage' => $user->can(DocumentPermission::MANAGE->value, $this->resource),
            ],
        ];
    }

    /** @return array{start: int, quote: string, snippet: string, offset: int}|null */
    private function contentMatch(): ?array
    {
        $literal = $this->resource->getAttribute('literal_hit');
        if (is_string($literal)) {
            return json_decode($literal, true, flags: JSON_THROW_ON_ERROR);
        }

        $morphological = $this->resource->getAttribute('morphological_hit');
        if (! is_string($morphological)) {
            return null;
        }

        ['ordinal' => $ordinal, 'content' => $content, 'highlighted' => $highlighted] = json_decode(
            $morphological,
            true,
            flags: JSON_THROW_ON_ERROR,
        );
        $open = SearchDocumentsQuery::MATCH_START;
        $close = SearchDocumentsQuery::MATCH_END;
        $start = mb_strpos($highlighted, $open);
        if ($start === false || str_replace([$open, $close], '', $highlighted) !== $content) {
            return null;
        }

        $quoteStart = $start + mb_strlen($open);
        $end = mb_strpos($highlighted, $close, $quoteStart);
        if ($end === false || $end === $quoteStart) {
            return null;
        }

        $length = $end - $quoteStart;
        $offset = min(72, $start);

        return [
            'start' => SearchIndexer::segmentStart($ordinal) + $start,
            'quote' => mb_substr($content, $start, $length),
            'snippet' => mb_substr($content, $start - $offset, $offset + $length + 108),
            'offset' => $offset,
        ];
    }
}
