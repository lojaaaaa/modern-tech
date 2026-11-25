<?php

declare(strict_types=1);

namespace App\Modules\Documents\Enums;

enum DocumentPermission: string
{
    case READ = 'read';
    case COMMENT = 'comment';
    case EDIT = 'edit';
    case EXPORT = 'export';
    case MANAGE = 'manage';
}
