<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class PreventApiCaching
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        if ($request->is('api/*')) {
            $response->headers->set('Cache-Control', 'private, no-store');
        }

        return $response;
    }
}
