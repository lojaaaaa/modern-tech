<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\DTO\IncomingFile;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Documents\Rules\DocumentFile;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;

final class UploadRequest extends FormRequest
{
    public const IDEMPOTENCY_HEADER = 'Idempotency-Key';

    public function authorize(DocumentPolicy $policy): Response
    {
        $document = $this->route('document');

        return $document instanceof Document
            ? $policy->uploadVersion($this->user(), $document)
            : $policy->create($this->user());
    }

    public function rules(): array
    {
        return [
            /** Maximum file size: 51200 kilobytes. */
            'file' => ['bail', 'required', 'file', new DocumentFile()],
            'title' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function getIncomingFile(): IncomingFile
    {
        $file = $this->validated('file');

        return new IncomingFile($file->getPathname(), $file->getClientOriginalName());
    }

    public function getIdempotencyKey(): string
    {
        $key = $this->header(self::IDEMPOTENCY_HEADER);

        abort_unless(
            is_string($key) && strlen($key) >= 8 && strlen($key) <= 100,
            422,
            __('documents.invalid_idempotency_key'),
        );

        return $key;
    }
}
