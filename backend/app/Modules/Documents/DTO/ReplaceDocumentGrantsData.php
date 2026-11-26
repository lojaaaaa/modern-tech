<?php

declare(strict_types=1);

namespace App\Modules\Documents\DTO;

final readonly class ReplaceDocumentGrantsData
{
    /** @param array<array-key, array{user_id: int, read: bool, comment: bool, edit: bool, export: bool}> $grants */
    public function __construct(public array $grants, public int $revision)
    {
    }
}
