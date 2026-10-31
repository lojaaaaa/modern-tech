<?php

declare(strict_types=1);

namespace App\Modules\Audit\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Audit
{
    /** @param array<string, scalar|null> $metadata */
    public static function record(?int $actor, string $action, ?string $resource = null, array $metadata = []): void
    {
        DB::table('audit_events')->insert(['id' => (string) Str::uuid(), 'actor_id' => $actor, 'action' => $action, 'resource_id' => $resource, 'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR), 'created_at' => now()]);
    }
}
