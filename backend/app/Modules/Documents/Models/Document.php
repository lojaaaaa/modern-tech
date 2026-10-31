<?php

declare(strict_types=1);

namespace App\Modules\Documents\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Document extends Model
{
    use HasUuids;

    protected $table = 'documents';

    protected $guarded = ['id'];

    use SoftDeletes;

    protected function casts(): array
    {
        return ['revision' => 'integer', 'deleted_at' => 'datetime', 'purge_after' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /** @return HasMany<DocumentVersion, $this> */
    public function versions(): HasMany
    {
        return $this->hasMany(DocumentVersion::class);
    }

    /** @return BelongsTo<DocumentVersion, $this> */
    public function publishedVersion(): BelongsTo
    {
        return $this->belongsTo(DocumentVersion::class, 'published_version_id');
    }

    /** @return BelongsTo<DocumentVersion, $this> */
    public function desiredVersion(): BelongsTo
    {
        return $this->belongsTo(DocumentVersion::class, 'desired_version_id');
    }

    /** @return HasMany<DocumentGrant, $this> */
    public function grants(): HasMany
    {
        return $this->hasMany(DocumentGrant::class);
    }

    public function scopeVisibleTo(Builder $query, User $user): void
    {
        if (! $user->active) {
            $query->whereRaw('1 = 0');

            return;
        }
        if ($user->isAdministrator()) {
            return;
        }
        $query->where(fn ($q) => $q->where('owner_id', $user->id)->orWhereHas('grants', fn ($g) => $g->where('user_id', $user->id)->where('read', true)));
    }
}
