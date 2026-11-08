<?php

declare(strict_types=1);

namespace App\Providers;

use App\Http\Documentation\ApiErrorResponses;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Processing\Services\ClamAvScanner;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\TikaExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Dedoc\Scramble\Scramble;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
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
        RateLimiter::for('registration', fn (Request $request) => Limit::perMinute(5)->by($request->ip())->response(fn (Request $request, array $headers) => abort(429, 'Слишком много попыток регистрации. Повторите через минуту.', $headers)));
        RateLimiter::for('email-verification', fn (Request $request) => Limit::perMinute(6)->by((string) $request->user()->getAuthIdentifier())->response(fn (Request $request, array $headers) => abort(429, 'Слишком много писем подтверждения. Повторите через минуту.', $headers)));

        ResetPassword::createUrlUsing(fn ($user, string $token) => config('app.url').'/reset-password?'.http_build_query(['token' => $token, 'email' => $user->email]));
    }
}
