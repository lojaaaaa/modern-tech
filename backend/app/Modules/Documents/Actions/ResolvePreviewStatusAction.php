<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Modules\Documents\DTO\PreviewStatusData;
use App\Modules\Documents\Enums\OfficeFileExtension;
use App\Modules\Documents\Enums\PreviewKind;
use App\Modules\Documents\Enums\PreviewStatus;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Cache\PreviewCache;
use App\Modules\Processing\Jobs\GeneratePreview;

final class ResolvePreviewStatusAction
{
    public function __construct(private readonly PreviewCache $cache)
    {
    }

    public function handle(DocumentVersion $version): PreviewStatusData
    {
        $structuredKind = match ($version->getFileExtension()) {
            'md' => PreviewKind::MARKDOWN,
            'csv' => PreviewKind::CSV,
            'xlsx' => PreviewKind::SPREADSHEET,
            default => null,
        };
        if ($structuredKind !== null) {
            return new PreviewStatusData($structuredKind, PreviewStatus::READY);
        }

        if ($version->hasNativePreview()) {
            $kind = str_starts_with($version->mime, 'image/') ? PreviewKind::IMAGE : PreviewKind::PDF;

            return new PreviewStatusData($kind, PreviewStatus::READY);
        }

        if (OfficeFileExtension::tryFrom($version->getFileExtension()) === null) {
            return new PreviewStatusData(PreviewKind::TEXT, PreviewStatus::READY);
        }

        if ($version->preview_key) {
            return new PreviewStatusData(PreviewKind::PDF, PreviewStatus::READY);
        }

        if ($this->cache->reserve($version->id)) {
            GeneratePreview::dispatch($version);
        }

        $status = $this->cache->hasError($version->id) ? PreviewStatus::FAILED : PreviewStatus::PENDING;

        return new PreviewStatusData(PreviewKind::PDF, $status);
    }
}
