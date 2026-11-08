<?php

declare(strict_types=1);

namespace App\Modules\Documents\Services;

use App\Modules\Documents\Models\Document;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

final class SearchDocuments
{
    /** @param Builder<Document> $query */
    public function apply(Builder $query, string $term): void
    {
        $pattern = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($term)).'%';
        $pgsql = DB::getDriverName() === 'pgsql';
        $query->where(function (Builder $q) use ($pattern, $term, $pgsql): void {
            $q->whereRaw('lower(title) LIKE ?', [$pattern])->orWhereExists(function ($segments) use ($term, $pattern, $pgsql): void {
                $segments->selectRaw('1')->from('text_segments')->whereColumn('version_id', 'documents.published_version_id');
                if ($pgsql) {
                    $segments->whereRaw("(search_ru @@ websearch_to_tsquery('russian', ?) OR search_en @@ websearch_to_tsquery('english', ?))", [$term, $term]);
                } else {
                    $segments->whereRaw('lower(content) LIKE ?', [$pattern]);
                }
            });
        });
        if ($pgsql) {
            $query->select('documents.*')->selectRaw("(SELECT CASE WHEN search_ru @@ websearch_to_tsquery('russian', ?) THEN ts_headline('russian', content, websearch_to_tsquery('russian', ?), 'StartSel=\"\", StopSel=\"\", MaxWords=35, MinWords=15') ELSE ts_headline('english', content, websearch_to_tsquery('english', ?), 'StartSel=\"\", StopSel=\"\", MaxWords=35, MinWords=15') END FROM text_segments WHERE version_id=documents.published_version_id AND (search_ru @@ websearch_to_tsquery('russian', ?) OR search_en @@ websearch_to_tsquery('english', ?)) ORDER BY (ts_rank_cd(search_ru, websearch_to_tsquery('russian', ?)) + ts_rank_cd(search_en, websearch_to_tsquery('english', ?))) DESC, ordinal LIMIT 1) AS matched_text", [$term, $term, $term, $term, $term, $term, $term])->selectRaw("(CASE WHEN lower(title) LIKE ? THEN 4 ELSE 0 END + COALESCE((SELECT MAX(ts_rank_cd(search_ru,websearch_to_tsquery('russian', ?)) + ts_rank_cd(search_en,websearch_to_tsquery('english', ?))) FROM text_segments WHERE version_id=documents.published_version_id),0)) AS relevance", [$pattern, $term, $term])->orderByDesc('relevance');
        }
    }
}
