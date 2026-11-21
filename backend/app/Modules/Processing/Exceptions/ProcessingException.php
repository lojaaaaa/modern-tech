<?php

declare(strict_types=1);

namespace App\Modules\Processing\Exceptions;

use App\Modules\Processing\Enums\ProcessingError;
use RuntimeException;
use Throwable;

final class ProcessingException extends RuntimeException
{
    public function __construct(public readonly ProcessingError $reason, ?Throwable $previous = null)
    {
        parent::__construct($reason->value, previous: $previous);
    }
}
