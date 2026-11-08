<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Modules\Identity\Actions\RegisterUser;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

final class RegistrationController
{
    public function __construct(private RegisterUser $register) {}

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(429, description: 'Registration attempts are rate limited per IP address.')]
    public function store(RegisterRequest $request): JsonResponse
    {
        $user = $this->register->handle($request->validated('name'), $request->validated('email'), $request->validated('password'));
        Auth::login($user);
        $request->session()->regenerate();

        return response()->json(['data' => $user], 201);
    }
}
