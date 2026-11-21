<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Session;

final class DestroyUserSessionsAction
{
    public function handle(User $user): void
    {
        DB::table('sessions')
            ->where('user_id', $user->id)
            ->pluck('id')
            ->each(fn (string $id) => Session::getHandler()->destroy($id));
    }
}
