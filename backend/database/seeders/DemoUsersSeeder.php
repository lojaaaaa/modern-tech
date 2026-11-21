<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use App\Modules\Identity\Enums\UserRole;
use Illuminate\Database\Seeder;

final class DemoUsersSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment('local')) {
            throw new \RuntimeException('Demo accounts are available only in local environment.');
        }
        foreach ([UserRole::ADMIN->value => 'Демо администратор', UserRole::EMPLOYEE->value => 'Демо сотрудник', UserRole::OBSERVER->value => 'Демо наблюдатель'] as $role => $name) {
            User::query()->firstOrCreate(
                ['email' => 'demo.'.$role.'@modern-tech.local'],
                ['name' => $name, 'password' => 'Demo-Local-2026!', 'role' => $role, 'active' => true],
            );
        }
    }
}
