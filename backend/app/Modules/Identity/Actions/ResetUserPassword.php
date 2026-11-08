<?php

declare(strict_types=1);

namespace App\Modules\Identity\Actions;

use App\Models\User;
use App\Modules\Audit\Services\Audit;
use Illuminate\Contracts\Auth\PasswordBroker;
use Illuminate\Contracts\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ResetUserPassword
{
    public function __construct(private PasswordBroker $passwords, private DatabaseManager $database, private Repository $config) {}

    public function handle(string $email, string $token, string $password): void
    {
        $status = $this->database->connection()->transaction(function () use ($email, $token, $password): string {
            $account = User::where('email', $email)->lockForUpdate()->first();
            if (! $account || ! $account->active) {
                return PasswordBroker::INVALID_TOKEN;
            }

            return $this->passwords->reset(['email' => $email, 'token' => $token, 'password' => $password, 'active' => true], function (User $user, string $password): void {
                $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
                if ($this->config->get('session.driver') === 'database') {
                    $this->database->connection($this->config->get('session.connection'))->table($this->config->get('session.table', 'sessions'))->where('user_id', $user->id)->delete();
                }
                Audit::record($user->id, 'user.password_reset', (string) $user->id);
            });
        });
        if ($status !== PasswordBroker::PASSWORD_RESET) {
            throw ValidationException::withMessages(['token' => 'Ссылка недействительна или срок её действия истёк.']);
        }
    }
}
