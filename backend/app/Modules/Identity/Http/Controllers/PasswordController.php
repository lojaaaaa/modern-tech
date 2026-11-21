<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Modules\Identity\Actions\RequestPasswordResetAction;
use App\Modules\Identity\Actions\ResetUserPasswordAction;
use App\Modules\Identity\Http\Requests\ForgotPasswordRequest;
use App\Modules\Identity\Http\Requests\ResetPasswordRequest;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

final class PasswordController
{
    public const RESET_THROTTLE_PREFIX = 'reset-password:';

    public const FORGOT_THROTTLE_PREFIX = 'forgot-password:';

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(429, description: 'Password recovery requests are rate limited.')]
    public function forgot(ForgotPasswordRequest $request, RequestPasswordResetAction $action): JsonResponse
    {
        $action->handle($request->validated('email'));

        return response()->json(['data' => ['message' => __('identity.password_reset_requested')]]);
    }

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(422, description: 'Invalid, expired, or already consumed reset token, or invalid password.')]
    #[Response(429, description: 'Password reset requests are rate limited.')]
    public function reset(ResetPasswordRequest $request, ResetUserPasswordAction $action): JsonResponse
    {
        $action->handle($request->getData());
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['data' => ['message' => __('identity.password_updated')]]);
    }
}
