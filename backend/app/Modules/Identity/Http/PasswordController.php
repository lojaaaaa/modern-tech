<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

final class PasswordController
{
    public function forgot(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => 'required|email|max:255']);
        Password::sendResetLink(['email' => mb_strtolower($data['email']), 'active' => true]);

        return response()->json(['data' => ['message' => 'Если учётная запись существует, письмо с инструкцией отправлено.']]);
    }

    public function reset(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => 'required|email|max:255', 'token' => 'required|string', 'password' => 'required|string|min:12|max:128|confirmed']);
        $status = Password::reset($data, function (User $user, string $password): void {
            abort_unless($user->active, 422, 'Ссылка недействительна.');
            DB::transaction(function () use ($user, $password): void {
                $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
                DB::table('sessions')->where('user_id', $user->id)->delete();
            });
        });
        abort_unless($status === Password::PASSWORD_RESET, 422, 'Ссылка недействительна или срок её действия истёк.');

        return response()->json(['data' => ['message' => 'Пароль обновлён. Войдите с новым паролем.']]);
    }
}
