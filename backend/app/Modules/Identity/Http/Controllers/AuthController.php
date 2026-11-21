<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Modules\Identity\Actions\AuthenticateUserAction;
use App\Modules\Identity\Http\Requests\LoginRequest;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

final class AuthController
{
    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(422, description: 'Invalid credentials, including blocked accounts.')]
    #[Response(429, description: 'Five failed attempts per email and IP per minute; Retry-After indicates the delay.')]
    public function login(LoginRequest $request, AuthenticateUserAction $action): JsonResponse
    {
        $user = $action->handle($request->validated('email'), $request->validated('password'));
        $request->session()->regenerate();

        return response()->json(['data' => $user]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $request->user()]);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['data' => null]);
    }
}
