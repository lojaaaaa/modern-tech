<?php

use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/vendor/autoload.php';
$app = require __DIR__.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$accounts = [
    ['demo.admin@modern-tech.local', 'admin', 'Демо администратор', '$2y$12$xq8TbcauGV9fgBcWwcYU4enNMelBtHs/ZbLjN74//P0mZrtfpW5Ui'],
    ['demo.employee@modern-tech.local', 'employee', 'Демо сотрудник', '$2y$12$Sp33.kLNBThl1To67BIdxOOhwwhxlBXzr/jCEAMrldqyrit7HNzBG'],
    ['demo.observer@modern-tech.local', 'observer', 'Демо наблюдатель', '$2y$12$O.cKyf0fh4AzZzuK8GXiqOhosmpWbCkSR.cUMyc6PR.Pm7zZYMqkG'],
];
DB::transaction(function () use ($accounts) {
    foreach ($accounts as [$email, $role, $name, $hash]) {
        $user = User::firstOrNew(['email' => $email]);
        if ($user->exists) {
            throw_unless($user->getRawOriginal('password') === $hash && $user->role === $role, 'Account already exists');
            continue;
        }
        $user->forceFill(['name' => $name, 'password' => $hash, 'role' => $role, 'active' => true, 'email_verified_at' => now()])->save();
    }
});
