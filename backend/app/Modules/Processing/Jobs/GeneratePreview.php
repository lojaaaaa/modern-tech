<?php

declare(strict_types=1);

namespace App\Modules\Processing\Jobs;

use App\Modules\Documents\Models\DocumentVersion;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

final class GeneratePreview implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 220;

    public function __construct(public string $versionId)
    {
        $this->onQueue('processing');
    }

    public function handle(): void
    {
        $lock = Cache::lock('preview:'.$this->versionId, 240);
        if (! $lock->get()) {
            return;
        }
        $temporary = tempnam(sys_get_temp_dir(), 'preview-');
        $stream = null;
        try {
            $version = DocumentVersion::find($this->versionId);
            if (! $version || ! $version->document || $version->status !== 'ready' || $version->preview_key) {
                return;
            }
            $extension = strtolower(pathinfo($version->original_name, PATHINFO_EXTENSION));
            if (! in_array($extension, ['docx', 'xlsx', 'pptx'], true)) {
                return;
            }
            $stream = Storage::disk('local')->readStream($version->storage_key);
            if (! is_resource($stream) || $temporary === false) {
                throw new RuntimeException('PREVIEW_UNAVAILABLE');
            }
            $response = Http::connectTimeout(10)->timeout(190)->withOptions(['allow_redirects' => false, 'sink' => $temporary, 'progress' => function ($total, $downloaded): void {
                if ($total > 104857600 || $downloaded > 104857600) {
                    throw new RuntimeException('PREVIEW_TOO_LARGE');
                }
            }])->attach('files', $stream, 'document.'.$extension)->post(config('processing.gotenberg_url').'/forms/libreoffice/convert');
            if (! $response->successful() || file_get_contents($temporary, false, null, 0, 5) !== '%PDF-') {
                throw new RuntimeException('PREVIEW_FAILED');
            }
            $key = 'previews/'.$version->id.'.pdf';
            $pdf = fopen($temporary, 'rb');
            try {
                Storage::disk('local')->put($key, $pdf);
            } finally {
                if (is_resource($pdf)) {
                    fclose($pdf);
                }
            }
            $version->update(['preview_key' => $key]);
            Cache::forget('preview-error:'.$version->id);
        } catch (\Throwable) {
            Cache::put('preview-error:'.$this->versionId, true, 300);
            throw new RuntimeException('PREVIEW_FAILED');
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
            if (is_string($temporary) && is_file($temporary)) {
                unlink($temporary);
            }
            $lock->release();
        }
    }
}
