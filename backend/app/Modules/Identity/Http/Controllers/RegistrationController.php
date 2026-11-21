<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Modules\Identity\Actions\RegisterUserAction;
use App\Modules\Identity\Http\Requests\RegisterRequest;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

final class RegistrationController
{
    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(429, description: 'Registration attempts are rate limited per IP address.')]
    public function store(RegisterRequest $request, RegisterUserAction $action): JsonResponse
    {
        $user = $action->handle($request->getData());
        Auth::login($user);
        $request->session()->regenerate();

        return response()->json(['data' => $user], 201);
    }
}
