<?php

declare(strict_types=1);

namespace App\Modules\Documents\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\Query\Builder;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

final class RemoveDocumentFiles implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    /** @var list<int> */
    public array $backoff = [15, 60, 300, 900];

    /** @param list<string> $keys */
    public function __construct(public array $keys)
    {
        $this->onQueue('short');
    }

    public function handle(): void
    {
        $disk = Storage::disk('local');
        foreach ($this->keys as $key) {
            $isReferenced = DB::table('document_versions')
                ->where(fn (Builder $versions) => $versions->where('storage_key', $key)->orWhere('preview_key', $key))
                ->exists()
                || DB::table('office_drafts')->where('storage_key', $key)->exists();

            if (! $isReferenced && $disk->exists($key) && ! $disk->delete($key)) {
                throw new RuntimeException('Document file storage cleanup failed.');
            }
        }
    }
}
