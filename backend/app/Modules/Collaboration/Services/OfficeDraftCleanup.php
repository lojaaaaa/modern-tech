<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Services;

use App\Modules\Documents\Jobs\RemoveDocumentFiles;
use Illuminate\Support\Facades\Storage;

final class OfficeDraftCleanup
{
    /** Only old, unreferenced drafts; active snapshots expire in 90 seconds. */
    public function handle(bool $delete = false): int
    {
        $disk = Storage::disk('local');
        $count = 0;
        foreach (['office-drafts', 'office-snapshots'] as $directory) {
            foreach ($disk->files($directory) as $key) {
                if ($disk->lastModified($key) >= now()->subDay()->timestamp) {
                    continue;
                }
                if (\Illuminate\Support\Facades\DB::table('office_drafts')->where('storage_key', $key)->exists()
                    || \Illuminate\Support\Facades\DB::table('document_versions')->where('storage_key', $key)->orWhere('preview_key', $key)->exists()) {
                    continue;
                }
                $count++;
                if ($delete) {
                    (new RemoveDocumentFiles([$key]))->handle();
                }
            }
        }
        return $count;
    }
}
