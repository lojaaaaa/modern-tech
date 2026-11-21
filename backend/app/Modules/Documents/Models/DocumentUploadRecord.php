<?php

declare(strict_types=1);

namespace App\Modules\Documents\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

final class DocumentUploadRecord extends Model
{
    protected $table = 'idempotency_records';

    protected $fillable = ['user_id', 'scope', 'key', 'request_hash', 'resource_id'];

    public static function forUpload(
        User $user,
        string $key,
        string $sha256,
        ?string $title,
        ?Document $document,
    ): self {
        $scope = 'upload:' . ($document->id ?? 'new');

        return new self([
            'user_id' => $user->id,
            'scope' => $scope,
            'key' => $key,
            'request_hash' => hash('sha256', implode('|', [$sha256, $title, $scope])),
        ]);
    }

    public function findPrevious(): ?self
    {
        return self::query()->where($this->only(['user_id', 'scope', 'key']))->first();
    }
}
