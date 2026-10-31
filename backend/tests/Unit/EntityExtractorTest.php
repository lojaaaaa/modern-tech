<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Processing\Services\EntityExtractor;
use PHPUnit\Framework\TestCase;

final class EntityExtractorTest extends TestCase
{
    public function test_extraction_preserves_unicode_offsets_and_types(): void
    {
        $text = '😀 ООО «Архив» 31.10.2026 счёт 1 200,50 RUB info@example.org';
        $entities = (new EntityExtractor)->extract($text);
        $this->assertEqualsCanonicalizing(['date', 'email', 'amount', 'organization'], array_column($entities, 'type'));
        foreach ($entities as $entity) {
            $this->assertSame($entity['value'], mb_substr($text, $entity['offset'], $entity['length']));
        }
    }
}
