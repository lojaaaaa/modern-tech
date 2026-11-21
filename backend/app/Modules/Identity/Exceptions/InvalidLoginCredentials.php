<?php

declare(strict_types=1);

namespace App\Modules\Identity\Exceptions;

use Illuminate\Validation\ValidationException;

final class InvalidLoginCredentials extends ValidationException
{
}
