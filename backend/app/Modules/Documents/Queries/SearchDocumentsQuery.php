<?php

declare(strict_types=1);

namespace App\Modules\Documents\Queries;

use App\Modules\Documents\Models\Document;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

final class SearchDocumentsQuery
{
    private const TITLE_MATCH = "lower(documents.title) LIKE lower(?) ESCAPE '!'";

    private const TEXT_MATCH = "lower(extracted_text) LIKE lower(?) ESCAPE '!'";

    private const MORPHOLOGY_MATCH = '(search_ru @@ terms.ru OR search_en @@ terms.en)';

    private const SEGMENT_RANK = '(ts_rank_cd(search_ru, terms.ru) + ts_rank_cd(search_en, terms.en))';

    // Delimiters are internal to this query and never sent to the browser.
    public const MATCH_START = '⟦MT:';

    public const MATCH_END = ':MT⟧';

    /** @param Builder<Document> $query */
    public function apply(Builder $query, string $term): void
    {
        $pattern = '%' . strtr($term, ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
        $titleMatch = self::TITLE_MATCH;
        $literalVersions = DB::table('document_versions')
            ->whereNotNull('extracted_text')
            ->whereRaw(self::TEXT_MATCH, [$pattern])
            ->select('id');
        $morphology = $this->segments($term)->whereRaw(self::MORPHOLOGY_MATCH);

        $position = DB::query()->selectRaw('strpos(lower(extracted_text), lower(?)) AS start, char_length(?) AS length', [$term, $term]);
        $literal = DB::table('document_versions')
            ->whereColumn('document_versions.id', 'documents.published_version_id')
            ->joinLateral($position, 'hit')
            ->where('hit.start', '>', 0)
            ->selectRaw(<<<'SQL'
                json_build_object(
                    'start', hit.start - 1,
                    'quote', substring(extracted_text from hit.start for hit.length),
                    'snippet', substring(
                        extracted_text from greatest(1, hit.start - 72)
                        for least(72, hit.start - 1) + hit.length + 108
                    ),
                    'offset', least(72, hit.start - 1)
                )
                SQL);

        $options = 'HighlightAll=true, StartSel=' . self::MATCH_START . ', StopSel=' . self::MATCH_END;
        $morphologicalHit = (clone $morphology)
            ->whereColumn('version_id', 'documents.published_version_id')
            ->selectRaw(
                <<<'SQL'
                    json_build_object('ordinal', ordinal, 'content', content, 'highlighted',
                        CASE WHEN search_ru @@ terms.ru THEN ts_headline('russian', content, terms.ru, ?)
                            ELSE ts_headline('english', content, terms.en, ?) END
                    )
                    SQL,
                [$options, $options],
            )
            ->orderByRaw(self::SEGMENT_RANK . ' DESC')
            ->orderBy('ordinal')
            ->limit(1);

        $rank = (clone $morphology)
            ->whereColumn('version_id', 'documents.published_version_id')
            ->selectRaw('MAX(' . self::SEGMENT_RANK . ')');

        $query
            ->where(fn (Builder $results) => $results
                ->whereRaw($titleMatch, [$pattern])
                ->orWhereIn('documents.published_version_id', $literalVersions)
                ->orWhereIn('documents.published_version_id', (clone $morphology)->select('version_id')))
            ->select('documents.*')
            ->selectRaw($titleMatch . ' AS matched_title', [$pattern])
            ->selectSub($literal, 'literal_hit')
            ->selectSub($morphologicalHit, 'morphological_hit')
            ->selectRaw(
                'CASE WHEN ' . $titleMatch . ' THEN 4 ELSE 0 END'
                    . ' + CASE WHEN documents.published_version_id IN (' . $literalVersions->toSql() . ') THEN 1 ELSE 0 END'
                    . ' + COALESCE((' . $rank->toSql() . '), 0) AS relevance',
                [$pattern, ...$literalVersions->getBindings(), ...$rank->getBindings()],
            )
            ->orderByDesc('relevance');
    }

    private function segments(string $term): QueryBuilder
    {
        $terms = DB::query()->selectRaw(
            "websearch_to_tsquery('russian', ?) AS ru, websearch_to_tsquery('english', ?) AS en",
            [$term, $term],
        );

        return DB::table('text_segments')->crossJoinSub($terms, 'terms');
    }
}
