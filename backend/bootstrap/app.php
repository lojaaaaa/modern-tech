<?php

declare(strict_types=1);

use App\Http\Middleware\RequestTelemetry;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\InvalidSignatureException;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php', commands: __DIR__.'/../routes/console.php', health: '/health/live')
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->append(RequestTelemetry::class);
        $middleware->trimStrings(except: ['anchor_quote']);
        $middleware->redirectGuestsTo(fn (Request $request) => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());
        $exceptions->render(function (Throwable $error, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }
            $status = $error instanceof ValidationException ? 422 : ($error instanceof HttpExceptionInterface ? $error->getStatusCode() : ($error instanceof AuthenticationException ? 401 : 500));
            $message = $status >= 500 ? 'Не удалось выполнить запрос. Попробуйте позже.' : ($error->getMessage() ?: 'Запрос отклонён.');
            if ($error instanceof InvalidSignatureException) {
                $message = 'Ссылка подтверждения недействительна или срок её действия истёк. Запросите новое письмо в приложении.';
            }

            return response()->json(['error' => ['code' => 'HTTP_'.$status, 'message' => $message, 'details' => $error instanceof ValidationException ? $error->errors() : new stdClass, 'request_id' => (string) Str::uuid()]], $status, $error instanceof HttpExceptionInterface ? $error->getHeaders() : []);
        });
    })->create();
