<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Modules\Identity\Actions\RequestPasswordReset;
use App\Modules\Identity\Actions\ResetUserPassword;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

final class PasswordController
{
    public function __construct(private RequestPasswordReset $requestReset, private ResetUserPassword $resetPassword) {}

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(429, description: 'Password recovery requests are rate limited.')]
    public function forgot(ForgotPasswordRequest $request): JsonResponse
    {
        $this->requestReset->handle($request->validated('email'));

        return response()->json(['data' => ['message' => 'Если учётная запись существует, письмо с инструкцией отправлено.']]);
    }

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(422, description: 'Invalid, expired, or already consumed reset token, or invalid password.')]
    #[Response(429, description: 'Password reset requests are rate limited.')]
    public function reset(ResetPasswordRequest $request): JsonResponse
    {
        $this->resetPassword->handle($request->validated('email'), $request->validated('token'), $request->validated('password'));
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['data' => ['message' => 'Пароль обновлён. Войдите с новым паролем.']]);
    }
}
