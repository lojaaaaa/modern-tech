<?php

declare(strict_types=1);

namespace App\Modules\Documents\Http\Requests;

use App\Modules\Documents\DTO\RenameDocumentData;
use App\Modules\Documents\Policies\DocumentPolicy;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;

final class RenameDocumentRequest extends FormRequest
{
    public function authorize(DocumentPolicy $policy): Response
    {
        return $policy->edit($this->user(), $this->route('document'));
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'revision' => ['required', 'integer'],
        ];
    }

    public function getData(): RenameDocumentData
    {
        return new RenameDocumentData(
            title: $this->string('title')->toString(),
            revision: $this->integer('revision'),
        );
    }
}
