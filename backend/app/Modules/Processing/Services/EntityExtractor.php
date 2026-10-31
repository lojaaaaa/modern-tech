<?php

declare(strict_types=1);

namespace App\Modules\Processing\Services;

use Illuminate\Support\Facades\DB;

final class EntityExtractor
{
    /** @return array<int,array{type:string,value:string,offset:int,length:int}> */
    public function extract(string $text): array
    {
        $entities = [];
        $rules = ['date' => '~\b(?:0?[1-9]|[12][0-9]|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)[0-9]{2}\b~u', 'email' => '~[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b~iu', 'amount' => '~\b\d+(?:[ \x{00a0}]\d{3})*(?:[,.]\d{2})?\s*(?:₽|руб\.?|RUB|USD|EUR)~iu', 'organization' => '~\b(?:ООО|АО|ПАО|ЗАО)\s+[«"]([^»"\n]{2,150})[»"]~u'];
        foreach ($rules as $type => $pattern) {
            preg_match_all($pattern, $text, $matches, PREG_OFFSET_CAPTURE);
            foreach (array_slice($matches[0], 0, 1000) as [$value,$offset]) {
                $entities[] = ['type' => $type, 'value' => $value, 'offset' => mb_strlen(substr($text, 0, $offset)), 'length' => mb_strlen($value)];
            }
        }

        return $entities;
    }

    public function replace(string $versionId, string $text): void
    {
        DB::table('document_entities')->where('version_id', $versionId)->delete();
        foreach ($this->extract($text) as $entity) {
            DB::table('document_entities')->insert($entity + ['version_id' => $versionId, 'source' => 'rules-v1']);
        }
    }
}
