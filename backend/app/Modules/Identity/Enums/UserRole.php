<?php

declare(strict_types=1);

namespace App\Modules\Identity\Enums;

enum UserRole: string
{
    case ADMIN = 'admin';
    case EMPLOYEE = 'employee';
    case OBSERVER = 'observer';
}
