<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Identity\DTO\ResetPasswordData;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ResetUserPasswordAction
{
    public function __construct(private DestroyUserSessionsAction $sessions)
    {
    }

    public function handle(ResetPasswordData $data): void
    {
        $status = DB::transaction(function () use ($data): string {
            $account = User::query()
                ->where('email', $data->email)
                ->where('active', true)
                ->lockForUpdate()
                ->first();

            if ($account === null) {
                return Password::INVALID_TOKEN;
            }

            return Password::reset(
                [...$data->toArray(), 'active' => true],
                function (User $user, string $password): void {
                    $user->forceFill([
                        'password' => $password,
                        'remember_token' => Str::random(60),
                    ])->save();

                    $this->sessions->handle($user);

                    AuditWriter::record(
                        $user->id,
                        'user.password_reset',
                        (string) $user->id,
                    );

                    DB::afterCommit(fn () => Event::dispatch(new PasswordReset($user)));
                },
            );
        }, attempts: 3);

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages([
                'token' => __('identity.password_reset_invalid'),
            ]);
        }
    }
}
