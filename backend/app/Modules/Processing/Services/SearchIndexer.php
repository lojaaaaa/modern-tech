<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

use Illuminate\Support\Facades\DB;

final class SearchIndexer
{
    public function replace(string $versionId, string $text): void
    {
        DB::table('text_segments')->where('version_id', $versionId)->delete();
        $length = mb_strlen($text);
        $ordinal = 0;
        for ($offset = 0; $offset < $length; $offset += 11800) {
            DB::table('text_segments')->insert(['version_id' => $versionId, 'ordinal' => $ordinal++, 'content' => mb_substr($text, $offset, 12000)]);
        }
    }
}
