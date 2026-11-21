<?php

declare(strict_types=1);

namespace App\Modules\Documents\DTO;

use App\Modules\Documents\Enums\PreviewKind;
use App\Modules\Documents\Enums\PreviewStatus;

final readonly class PreviewStatusData
{
    public function __construct(
        public PreviewKind $kind,
        public PreviewStatus $status,
    ) {
    }
}
