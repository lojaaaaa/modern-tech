<?php

declare(strict_types=1);

namespace App\Modules\Documents\Models;

use App\Modules\Documents\Enums\DocumentVersionStatus;
use App\Modules\Documents\Enums\OfficeFileExtension;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentVersion extends Model
{
    use HasUuids;

    protected $table = 'document_versions';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['number' => 'integer', 'size' => 'integer'];
    }

    /** @return BelongsTo<Document, $this> */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function getFileExtension(): string
    {
        return strtolower(pathinfo($this->original_name, PATHINFO_EXTENSION));
    }

    public function isReady(): bool
    {
        return $this->status === DocumentVersionStatus::READY->value;
    }

    public function hasNativePreview(): bool
    {
        return in_array($this->mime, ['application/pdf', 'image/png', 'image/jpeg'], true);
    }

    public function canGeneratePreview(): bool
    {
        return $this->isReady()
            && ! $this->preview_key
            && OfficeFileExtension::tryFrom($this->getFileExtension()) !== null
            && $this->document()->exists();
    }
}
