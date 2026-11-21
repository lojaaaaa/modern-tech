<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

use Illuminate\Support\Facades\DB;

final class EntityExtractor
{
    private const RULES = [
        'date' => '~\b(?:0?[1-9]|[12][0-9]|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)[0-9]{2}\b~u',
        'email' => '~[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b~iu',
        'amount' => '~\b\d+(?:[ \x{00a0}]\d{3})*(?:[,.]\d{2})?\s*(?:₽|руб\.?|RUB|USD|EUR)~iu',
        'organization' => '~\b(?:ООО|АО|ПАО|ЗАО)\s+[«"]([^»"\n]{2,150})[»"]~u',
    ];

    /** @return array<int,array{type:string,value:string,offset:int,length:int}> */
    public function extract(string $text): array
    {
        $entities = [];
        foreach (self::RULES as $type => $pattern) {
            $byteOffset = 0;
            $characterOffset = 0;
            for ($count = 0; $count < 1000; $count++) {
                if (preg_match($pattern, $text, $matches, PREG_OFFSET_CAPTURE, $byteOffset) !== 1) {
                    break;
                }

                [$value, $start] = $matches[0];
                $characterOffset += mb_strlen(substr($text, $byteOffset, $start - $byteOffset));
                $length = mb_strlen($value);
                $entities[] = ['type' => $type, 'value' => $value, 'offset' => $characterOffset, 'length' => $length];
                $byteOffset = $start + strlen($value);
                $characterOffset += $length;
            }
        }

        return $entities;
    }

    /** @param array<int, array{type: string, value: string, offset: int, length: int}> $entities */
    public function replace(string $versionId, array $entities): void
    {
        DB::table('document_entities')->where('version_id', $versionId)->delete();
        foreach (array_chunk($entities, 100) as $batch) {
            $rows = [];
            foreach ($batch as $entity) {
                $rows[] = $entity + ['version_id' => $versionId, 'source' => 'rules-v1'];
            }
            DB::table('document_entities')->insert($rows);
        }
    }
}
