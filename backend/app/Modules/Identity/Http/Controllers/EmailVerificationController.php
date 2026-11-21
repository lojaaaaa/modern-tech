<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Modules\Identity\Actions\ResendEmailVerificationAction;
use App\Modules\Identity\Actions\VerifyEmailAddressAction;
use Dedoc\Scramble\Attributes\IgnoreResponse;
use Dedoc\Scramble\Attributes\PathParameter;
use Dedoc\Scramble\Attributes\QueryParameter;
use Dedoc\Scramble\Attributes\Response;
use Illuminate\Foundation\Auth\EmailVerificationRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

final class EmailVerificationController
{
    #[PathParameter('id', type: 'int')]
    #[PathParameter('hash', type: 'string')]
    #[QueryParameter('expires', required: true, type: 'int')]
    #[QueryParameter('signature', required: true, type: 'string')]
    #[IgnoreResponse(422)]
    #[Response(403, description: 'The signed link is expired, modified, or belongs to another account.')]
    public function show(EmailVerificationRequest $request, VerifyEmailAddressAction $action): JsonResponse|RedirectResponse
    {
        $user = $action->handle($request->user());

        return $request->expectsJson()
            ? response()->json(['data' => $user])
            : redirect(config('app.url').'/?email_verified=1');
    }

    #[Response(419, description: 'The CSRF session token is missing or expired.')]
    #[Response(429, description: 'Verification mail requests are rate limited per account.')]
    public function store(Request $request, ResendEmailVerificationAction $action): JsonResponse
    {
        if ($action->handle($request->user())) {
            return response()->json(['data' => ['message' => __('identity.email_verification_queued')]], 202);
        }

        return response()->json(['data' => ['message' => __('identity.email_already_verified')]]);
    }
}
