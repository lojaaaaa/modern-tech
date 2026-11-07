<?php

declare(strict_types=1);

namespace App\Providers;

use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Policies\DocumentPolicy;
use App\Modules\Processing\Services\ClamAvScanner;
use App\Modules\Processing\Services\TextExtractor;
use App\Modules\Processing\Services\TikaExtractor;
use App\Modules\Processing\Services\VirusScanner;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(VirusScanner::class, ClamAvScanner::class);
        $this->app->bind(TextExtractor::class, TikaExtractor::class);
    }

    public function boot(): void
    {
        Gate::policy(Document::class, DocumentPolicy::class);

        ResetPassword::createUrlUsing(fn ($user, string $token) => config('app.url').'/reset-password?'.http_build_query(['token' => $token, 'email' => $user->email]));
    }
}
