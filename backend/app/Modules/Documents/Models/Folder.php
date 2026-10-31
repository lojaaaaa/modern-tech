<?php

declare(strict_types=1);

namespace App\Modules\Documents\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Folder extends Model
{
    use HasUuids;

    protected $table = 'folders';

    protected $guarded = ['id'];
}
