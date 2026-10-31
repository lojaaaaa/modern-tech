<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

final class RequestTelemetry
{
    public function handle(Request $request, Closure $next)
    {
        $id = (string) Str::uuid();
        $start = microtime(true);
        $response = $next($request);
        $response->headers->set('X-Request-ID', $id);
        Log::info('http.request', ['request_id' => $id, 'method' => $request->method(), 'route' => $request->route()?->uri(), 'status' => $response->getStatusCode(), 'duration_ms' => round((microtime(true) - $start) * 1000, 2)]);

        return $response;
    }
}
