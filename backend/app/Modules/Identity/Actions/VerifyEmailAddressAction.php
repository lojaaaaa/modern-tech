<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use Illuminate\Auth\Events\Verified;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

final class VerifyEmailAddressAction
{
    public function handle(User $actor): User
    {
        return DB::transaction(function () use ($actor): User {
            $user = User::query()
                ->whereKey($actor->id)
                ->lockForUpdate()
                ->firstOrFail();

            abort_unless(
                hash_equals($actor->getEmailForVerification(), $user->getEmailForVerification()),
                403,
                __('identity.verification_link_invalid'),
            );

            if (! $user->hasVerifiedEmail()) {
                $user->markEmailAsVerified();

                AuditWriter::record(
                    $user->id,
                    'user.email_verified',
                    (string) $user->id,
                );

                DB::afterCommit(fn () => Event::dispatch(new Verified($user)));
            }

            return $user;
        }, attempts: 3);
    }
}
