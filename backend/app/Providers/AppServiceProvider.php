<?php

declare(strict_types=1);

namespace App\Providers;

use App\Http\Documentation\ApiErrorResponses;
use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Identity\Exceptions\InvalidLoginCredentials;
use App\Modules\Identity\Http\Requests\LoginRequest;
use App\Modules\Identity\Policies\UserPolicy;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Models\CloudTransfer;
use App\Modules\Integrations\Policies\CloudConnectionPolicy;
use App\Modules\Integrations\Policies\CloudTransferPolicy;
use App\Modules\Processing\Services\ClamAvScanner;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\TikaExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Dedoc\Scramble\Scramble;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Symfony\Component\HttpFoundation\Response;

class AppServiceProvider extends ServiceProvider
{
    public const LOGIN_LIMITER = 'login';
    public const REGISTRATION_LIMITER = 'registration';

    public function register(): void
    {
        $this->app->bind(StatefulGuard::class, fn ($app) => $app['auth']->guard('web'));
        $this->app->bind(VirusScanner::class, ClamAvScanner::class);
        $this->app->bind(TextExtractor::class, TikaExtractor::class);
    }

    public function boot(): void
    {
        Scramble::configure()->withDocumentTransformers([ApiErrorResponses::class]);
        Gate::policy(Document::class, DocumentPolicy::class);
        Gate::policy(User::class, UserPolicy::class);
        Gate::policy(CloudConnection::class, CloudConnectionPolicy::class);
        Gate::policy(CloudTransfer::class, CloudTransferPolicy::class);
        RateLimiter::for(self::LOGIN_LIMITER, function (Request $request) {
            $email = $request->input('email');
            if (! is_string($email)) {
                return Limit::none();
            }

            $key = hash('sha256', LoginRequest::normalizeEmail($email).'|'.($request->ip() ?? 'unknown'));

            return Limit::perMinute(5)
                ->by($key)
                ->after(function (Response $response) use ($key): bool {
                    if ($response->isSuccessful()) {
                        // ThrottleRequests hashes the limiter name and key together.
                        RateLimiter::clear(md5(self::LOGIN_LIMITER . $key));
                    }

                    return $response instanceof JsonResponse && $response->exception instanceof InvalidLoginCredentials;
                })
                ->response(fn (Request $request, array $headers) => abort(
                    429,
                    'Слишком много попыток. Попробуйте через минуту.',
                    $headers,
                ));
        });
        RateLimiter::for(self::REGISTRATION_LIMITER, fn (Request $request) => Limit::perMinute(5)->by($request->ip())->response(fn (Request $request, array $headers) => abort(429, 'Слишком много попыток регистрации. Повторите через минуту.', $headers)));

        ResetPassword::createUrlUsing(fn ($user, string $token) => config('app.url').'/reset-password?'.http_build_query(['token' => $token, 'email' => $user->email]));
    }
}
