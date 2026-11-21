<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureActive
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->isActive()) {
            auth()->logout();
            $request->session()->invalidate();
            abort(401, __('identity.account_unavailable'));
        }

        return $next($request);
    }
}
