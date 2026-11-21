<?php

declare(strict_types=1);

namespace App\Modules\Documents\Models;

use App\Modules\Identity\Enums\UserRole;
use Illuminate\Database\Eloquent\Model;

/**
 * @property bool $read
 * @property bool $comment
 * @property bool $edit
 * @property bool $export
 */
class DocumentGrant extends Model
{
    protected $table = 'document_grants';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['read' => 'boolean', 'comment' => 'boolean', 'edit' => 'boolean', 'export' => 'boolean'];
    }

    /** Returns the translation key for permissions that cannot be granted to this role. */
    public function getPermissionViolation(UserRole $role): ?string
    {
        if (! $this->comment && ! $this->edit && ! $this->export) {
            return null;
        }

        return match (true) {
            ! $this->read => 'documents.additional_permissions_require_read',
            $role === UserRole::OBSERVER => 'documents.observer_can_only_read',
            default => null,
        };
    }
}
