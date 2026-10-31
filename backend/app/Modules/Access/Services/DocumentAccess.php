<?php

declare(strict_types=1);

namespace App\Modules\Access\Services;

use App\Models\User;
use App\Modules\Documents\Models\Document;

final class DocumentAccess
{
    public function allows(User $user, Document $document, string $action): bool
    {
        if (! $user->active) {
            return false;
        }
        if ($user->isAdministrator()) {
            return true;
        }
        if ($user->role === 'observer' && $action !== 'read') {
            return false;
        }
        if ((int) $document->owner_id === $user->id) {
            return true;
        }
        if (! in_array($action, ['read', 'comment', 'edit', 'export'], true)) {
            return false;
        }

        if ($document->relationLoaded('grants')) {
            return $document->grants->contains(fn ($grant) => (int) $grant->user_id === $user->id && $grant->read && $grant->{$action});
        }

        return $document->grants()->where('user_id', $user->id)->where('read', true)->where($action, true)->exists();
    }

    public function authorize(User $user, Document $document, string $action): void
    {
        abort_unless($this->allows($user, $document, 'read'), 404);
        abort_unless($this->allows($user, $document, $action), 403);
    }
}
