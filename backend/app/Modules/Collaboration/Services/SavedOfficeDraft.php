<?php

declare(strict_types=1);

namespace App\Modules\Collaboration\Services;

use App\Modules\Documents\DTO\IncomingFile;
use App\Modules\Documents\Models\Document;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final readonly class SavedOfficeDraft
{
    public function __construct(private OfficeEditingStatus $editor)
    {
    }

    public function file(Document $document): IncomingFile
    {
        $version = $document->publishedVersion;
        abort_unless($version?->isReady() && $version->id === $document->desired_version_id, 409, 'Дождитесь публикации текущей версии.');
        $draft = DB::table('office_drafts')
            ->where('document_id', $document->id)
            ->where('source_version_id', $version->id)
            ->lockForUpdate()
            ->first();
        abort_if($draft === null, 409, 'Сохранённого рабочего черновика ещё нет.');
        $this->editor->requireClosed($draft->editor_key);

        $disk = Storage::disk('local');
        abort_unless($disk->exists($draft->storage_key), 409, 'Файл рабочего черновика недоступен.');
        $file = new IncomingFile($disk->path($draft->storage_key), $version->original_name);
        abort_if($file->sha256() === $version->sha256, 409, 'Черновик совпадает с текущей версией.');

        return $file;
    }
}
