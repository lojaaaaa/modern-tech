<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\Models\Document;
use Illuminate\Foundation\Http\FormRequest;

final class RestoreDocumentRequest extends FormRequest
{
    public function getDocument(): Document
    {
        return Document::query()->onlyTrashed()->findOrFail($this->route('id'));
    }
}
