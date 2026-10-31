<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class CloudTransfer extends Model
{
    use HasUuids;

    protected $guarded = ['id'];
}
