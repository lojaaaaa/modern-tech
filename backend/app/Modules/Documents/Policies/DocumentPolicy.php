<?php

declare(strict_types=1);

namespace App\Modules\Documents\Policies;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use Illuminate\Auth\Access\Response;

final class DocumentPolicy
{
    public function read(User $user, Document $document): Response
    {
        return $this->allows($user, $document, 'read')
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function comment(User $user, Document $document): Response
    {
        return $this->permissionResponse($user, $document, 'comment');
    }

    public function edit(User $user, Document $document): Response
    {
        return $this->permissionResponse($user, $document, 'edit');
    }

    public function export(User $user, Document $document): Response
    {
        return $this->permissionResponse($user, $document, 'export');
    }

    public function manage(User $user, Document $document): Response
    {
        return $this->permissionResponse($user, $document, 'manage');
    }

    private function permissionResponse(User $user, Document $document, string $permission): Response
    {
        $read = $this->read($user, $document);
        if ($read->denied()) {
            return $read;
        }
        if (in_array($permission, ['edit', 'comment', 'manage'], true) && ! $user->hasVerifiedEmail()) {
            return Response::deny('Подтвердите электронную почту перед изменением документа.');
        }

        return $this->allows($user, $document, $permission)
            ? Response::allow()
            : Response::deny();
    }

    private function allows(User $user, Document $document, string $permission): bool
    {
        if (! $user->active) {
            return false;
        }
        if ($user->isAdministrator()) {
            return true;
        }
        if ($user->role === 'observer' && $permission !== 'read') {
            return false;
        }
        if ((int) $document->owner_id === $user->id) {
            return true;
        }
        if ($permission === 'manage') {
            return false;
        }
        if ($document->relationLoaded('grants')) {
            return $document->grants->contains(fn ($grant) => (int) $grant->user_id === $user->id && $grant->read && $grant->{$permission});
        }

        return $document->grants()->where('user_id', $user->id)->where('read', true)->where($permission, true)->exists();
    }
}
