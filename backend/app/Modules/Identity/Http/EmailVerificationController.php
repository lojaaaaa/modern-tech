<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http;

use App\Modules\Identity\Actions\ResendEmailVerification;
use App\Modules\Identity\Actions\VerifyEmailAddress;
use Dedoc\Scramble\Attributes\QueryParameter;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

final class EmailVerificationController
{
    public function __construct(private VerifyEmailAddress $verify, private ResendEmailVerification $resend) {}

    #[QueryParameter('expires', required: true, type: 'int')]
    #[QueryParameter('signature', required: true, type: 'string')]
    #[Response(403, description: 'The signed link is expired, modified, or belongs to another account.')]
    public function show(Request $request, int $id, string $hash): JsonResponse|RedirectResponse
    {
        $user = $this->verify->handle($request->user(), $id, $hash);

        return $request->expectsJson()
            ? response()->json(['data' => $user])
            : redirect(config('app.url').'/?email_verified=1');
    }

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(429, description: 'Verification mail requests are rate limited per account.')]
    public function store(Request $request): JsonResponse
    {
        if ($this->resend->handle($request->user())) {
            return response()->json(['data' => ['message' => 'Письмо подтверждения поставлено в очередь отправки.']], 202);
        }

        return response()->json(['data' => ['message' => 'Электронная почта уже подтверждена.']]);
    }
}
