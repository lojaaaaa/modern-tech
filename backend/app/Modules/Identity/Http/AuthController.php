<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Modules\Identity\Actions\AuthenticateUser;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

final class AuthController
{
    public function __construct(private AuthenticateUser $authenticate) {}

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(422, description: 'Invalid credentials, including blocked accounts.')]
    #[Response(429, description: 'Five failed attempts per email and IP per minute; Retry-After indicates the delay.')]
    public function login(LoginRequest $request): JsonResponse
    {
        $user = $this->authenticate->handle($request->validated('email'), $request->validated('password'), $request->ip() ?? 'unknown');
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
