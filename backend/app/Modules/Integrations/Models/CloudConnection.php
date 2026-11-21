<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Models;

use App\Models\User;
use App\Modules\Integrations\Enums\CloudConnectionStatus;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** @property array<string, string> $credentials */
class CloudConnection extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected $hidden = ['credentials'];

    protected function casts(): array
    {
        return ['credentials' => 'encrypted:array', 'status' => CloudConnectionStatus::class];
    }

    public function getCredentialsFingerprint(): string
    {
        return hash('sha256', $this->getRawOriginal('credentials') . '|' . $this->status->value);
    }

    public function isOwnedBy(User $user): bool
    {
        return $this->owner_id === $user->id;
    }

    /** @param Builder<self> $query */
    #[Scope]
    protected function ownedBy(Builder $query, User $user): void
    {
        $query->where('owner_id', $user->id);
    }

    /** @param Builder<self> $query */
    #[Scope]
    protected function connected(Builder $query): void
    {
        $query->where('status', CloudConnectionStatus::CONNECTED);
    }
}
