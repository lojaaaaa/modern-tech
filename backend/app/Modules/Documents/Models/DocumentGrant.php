<?php

declare(strict_types=1);

namespace App\Modules\Documents\Models;

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
}
