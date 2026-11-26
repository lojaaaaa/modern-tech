<?php

declare(strict_types=1);

namespace App\Modules\Documents\Policies;

use App\Models\User;
use App\Modules\Documents\Enums\DocumentPermission;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Auth\Access\Response;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

final class DocumentPolicy
{
    public function create(User $user): Response
    {
        if (! $user->isActive() || $user->role === UserRole::OBSERVER) {
            return Response::deny(__('documents.upload_unavailable'));
        }

        return Response::allow();
    }

    public function uploadVersion(User $user, Document $document): Response
    {
        $upload = $this->create($user);

        return $upload->denied() ? $upload : $this->edit($user, $document);
    }

    public function read(User $user, Document $document): Response
    {
        return $this->allows($user, $document, DocumentPermission::READ)
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function preview(User $user, DocumentVersion $version): Response
    {
        $read = $this->readVersion($user, $version);
        if ($read->denied()) {
            return $read;
        }

        return $version->isReady() ? Response::allow() : Response::denyWithStatus(HttpResponse::HTTP_CONFLICT);
    }

    public function readVersion(User $user, DocumentVersion $version): Response
    {
        $document = $version->document;
        if ($document === null || ! $this->allows($user, $document, DocumentPermission::READ)) {
            return Response::denyAsNotFound();
        }

        return $version->id === $document->published_version_id
            || $this->allows($user, $document, DocumentPermission::EDIT)
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function comment(User $user, Document $document): Response
    {
        return $this->getPermissionResponse($user, $document, DocumentPermission::COMMENT);
    }

    public function edit(User $user, Document $document): Response
    {
        return $this->getPermissionResponse($user, $document, DocumentPermission::EDIT);
    }

    public function export(User $user, Document $document): Response
    {
        return $this->getPermissionResponse($user, $document, DocumentPermission::EXPORT);
    }

    public function manage(User $user, Document $document): Response
    {
        return $this->getPermissionResponse($user, $document, DocumentPermission::MANAGE);
    }

    private function getPermissionResponse(
        User $user,
        Document $document,
        DocumentPermission $permission,
    ): Response {
        $read = $this->read($user, $document);
        if ($read->denied()) {
            return $read;
        }

        return $this->allows($user, $document, $permission)
            ? Response::allow()
            : Response::deny();
    }

    private function allows(User $user, Document $document, DocumentPermission $permission): bool
    {
        if (! $user->isActive()) {
            return false;
        }
        if ($user->isAdministrator()) {
            return true;
        }
        if ($user->role === UserRole::OBSERVER && $permission !== DocumentPermission::READ) {
            return false;
        }
        if ((int) $document->owner_id === $user->id) {
            return true;
        }
        if ($permission === DocumentPermission::MANAGE) {
            return false;
        }
        if ($document->relationLoaded('grants')) {
            return $document->grants->contains(
                fn ($grant) => (int) $grant->user_id === $user->id && $grant->read && $grant->{$permission->value},
            );
        }

        return $document->grants()
            ->where('user_id', $user->id)
            ->where(DocumentPermission::READ->value, true)
            ->where($permission->value, true)
            ->exists();
    }
}
