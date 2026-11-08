<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use Illuminate\Database\DatabaseManager;

final class AdministrationLock
{
    public function __construct(private DatabaseManager $database) {}

    public function acquire(): void
    {
        if ($this->database->connection()->getDriverName() === 'pgsql') {
            // One stable transaction-scoped lock serializes all administration changes.
            $this->database->select('select pg_advisory_xact_lock(?, ?)', [0x4944454E, 1]);
        }
    }
}
