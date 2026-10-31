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
        if (! $request->user()?->active) {
            auth()->logout();
            $request->session()->invalidate();
            abort(401, 'Учётная запись недоступна.');
        }

        return $next($request);
    }
}
