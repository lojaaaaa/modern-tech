<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

use Illuminate\Support\Facades\DB;

final class SearchIndexer
{
    private const SEGMENT_LENGTH = 12000;
    private const OVERLAP = 200;

    /** @return list<string> */
    public function segments(string $text): array
    {
        $chunks = mb_str_split($text, self::SEGMENT_LENGTH - self::OVERLAP);
        $segments = [];
        foreach ($chunks as $index => $chunk) {
            $segments[] = $chunk . mb_substr($chunks[$index + 1] ?? '', 0, self::OVERLAP);
        }

        return $segments;
    }

    /** @param list<string> $segments */
    public function replace(string $versionId, array $segments): void
    {
        DB::table('text_segments')->where('version_id', $versionId)->delete();
        foreach (array_chunk($segments, 100, preserve_keys: true) as $batch) {
            $rows = [];
            foreach ($batch as $ordinal => $content) {
                $rows[] = ['version_id' => $versionId, 'ordinal' => $ordinal, 'content' => $content];
            }
            DB::table('text_segments')->insert($rows);
        }
    }
}
