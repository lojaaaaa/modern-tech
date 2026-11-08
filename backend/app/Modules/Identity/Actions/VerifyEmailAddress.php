<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use Illuminate\Auth\Events\Verified;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Database\ConnectionInterface;

final class VerifyEmailAddress
{
    public function __construct(private ConnectionInterface $database, private Dispatcher $events) {}

    public function handle(User $actor, int $id, string $hash): User
    {
        abort_unless($actor->id === $id, 403, 'Ссылка подтверждения принадлежит другой учётной записи.');

        return $this->database->transaction(function () use ($actor, $hash): User {
            $user = User::whereKey($actor->id)->lockForUpdate()->firstOrFail();
            abort_unless($user->active && hash_equals(sha1($user->getEmailForVerification()), $hash), 403, 'Ссылка подтверждения недействительна.');
            if (! $user->hasVerifiedEmail()) {
                $user->markEmailAsVerified();
                Audit::record($user->id, 'user.email_verified', (string) $user->id);
                $this->events->dispatch(new Verified($user));
            }

            return $user;
        });
    }
}
