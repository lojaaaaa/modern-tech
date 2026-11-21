<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Resources;

use App\Modules\Documents\DTO\PreviewStatusData;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin PreviewStatusData */
final class PreviewStatusResource extends JsonResource
{
    /** @return array{kind: string, status: string} */
    public function toArray(Request $request): array
    {
        return [
            'kind' => $this->kind->value,
            'status' => $this->status->value,
        ];
    }
}
