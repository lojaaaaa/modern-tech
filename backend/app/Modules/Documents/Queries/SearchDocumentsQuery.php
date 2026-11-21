<?php

declare(strict_types=1);

namespace App\Modules\Documents\Queries;

use App\Modules\Documents\Models\Document;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

final class SearchDocumentsQuery
{
    private const TITLE_MATCH = 'strpos(lower(documents.title), lower(?)) > 0';

    private const SEGMENT_RANK = <<<'SQL'
        ts_rank_cd(search_ru, terms.ru) + ts_rank_cd(search_en, terms.en)
        SQL;

    private const HEADLINE = <<<'SQL'
        CASE
            WHEN search_ru @@ terms.ru
                THEN ts_headline('russian', content, terms.ru, 'StartSel="", StopSel="", MaxWords=35, MinWords=15')
            ELSE ts_headline(
                'english', content, terms.en, 'StartSel="", StopSel="", MaxWords=35, MinWords=15'
            )
        END
        SQL;

    /** @param Builder<Document> $query */
    public function apply(Builder $query, string $term): void
    {
        $segments = $this->publishedSegments($term);
        $matches = (clone $segments)->whereRaw('(search_ru @@ terms.ru OR search_en @@ terms.en)');
        $headline = (clone $matches)
            ->selectRaw(self::HEADLINE)
            ->orderByRaw('(' . self::SEGMENT_RANK . ') DESC')
            ->orderBy('ordinal')
            ->limit(1);
        $rank = $segments->selectRaw(
            'CASE WHEN ' . self::TITLE_MATCH . ' THEN 4 ELSE 0 END + COALESCE(MAX(' . self::SEGMENT_RANK . '), 0)',
            [$term],
        );

        $query
            ->whereNotNull('published_version_id')
            ->where(
                fn (Builder $results) => $results
                    ->whereRaw(self::TITLE_MATCH, [$term])
                    ->orWhereExists($matches->selectRaw('1')),
            )
            ->select('documents.*')
            ->selectSub($headline, 'matched_text')
            ->selectSub($rank, 'relevance')
            ->orderByDesc('relevance');
    }

    private function publishedSegments(string $term): QueryBuilder
    {
        $terms = DB::query()->selectRaw(
            "websearch_to_tsquery('russian', ?) AS ru, websearch_to_tsquery('english', ?) AS en",
            [$term, $term],
        );

        return DB::table('text_segments')
            ->crossJoinSub($terms, 'terms')
            ->whereColumn('version_id', 'documents.published_version_id');
    }
}
