<?php

declare(strict_types=1);

use App\Http\Middleware\EnsureActive;
use App\Modules\Audit\Http\Controllers\AuditController;
use App\Modules\Collaboration\Http\Controllers\CommentController;
use App\Modules\Collaboration\Http\Controllers\OfficeController;
use App\Modules\Documents\Http\Controllers\BatchController;
use App\Modules\Documents\Http\Controllers\DocumentController;
use App\Modules\Documents\Http\Controllers\LibraryController;
use App\Modules\Documents\Http\Controllers\PreviewController;
use App\Modules\Identity\Http\Controllers\AuthController;
use App\Modules\Identity\Http\Controllers\PasswordController;
use App\Modules\Identity\Http\Controllers\RegistrationController;
use App\Modules\Identity\Http\Controllers\UserController;
use App\Modules\Integrations\Http\Controllers\ConnectionController;
use App\Modules\Integrations\Http\Controllers\TransferController;
use App\Modules\Integrations\Http\Controllers\YandexOAuthController;
use App\Modules\Observability\Http\Controllers\MetricsController;
use App\Modules\Observability\Http\Controllers\ReadinessController;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Route;

Route::get('/health/ready', ReadinessController::class);

Route::prefix('api/v1')->group(function (): void {
    Route::get('/connections/yandex/callback', [YandexOAuthController::class, 'callback'])
        ->middleware('throttle:60,1,'.YandexOAuthController::CALLBACK_THROTTLE_PREFIX);

    Route::prefix('office')->controller(OfficeController::class)->group(function (): void {
        Route::get('/source/{capability}', 'source')->where('capability', '[A-Za-z0-9._-]+');
        Route::post('/callback', 'callback');
    });

    Route::prefix('auth')->group(function (): void {
        Route::post('/register', [RegistrationController::class, 'store'])
            ->middleware('throttle:'.AppServiceProvider::REGISTRATION_LIMITER);
        Route::post('/login', [AuthController::class, 'login'])
            ->middleware('throttle:'.AppServiceProvider::LOGIN_LIMITER);

        Route::controller(PasswordController::class)->group(function (): void {
            Route::post('/forgot-password', 'forgot')
                ->middleware('throttle:3,15,'.PasswordController::FORGOT_THROTTLE_PREFIX);
            Route::post('/reset-password', 'reset')
                ->middleware('throttle:10,1,'.PasswordController::RESET_THROTTLE_PREFIX);
        });
    });

    Route::middleware(['auth', EnsureActive::class, 'auth.session'])->group(function (): void {
        Route::controller(AuthController::class)->group(function (): void {
            Route::get('/me', 'me');
            Route::post('/auth/logout', 'logout');
        });

        Route::prefix('admin')->group(function (): void {
            Route::get('/metrics', MetricsController::class);
            Route::get('/audit', [AuditController::class, 'index']);
        });

        Route::prefix('users')->controller(UserController::class)->group(function (): void {
            Route::get('/', 'index');
            Route::post('/', 'store');
            Route::patch('/{user}', 'update');
        });

        Route::prefix('connections')->group(function (): void {
            Route::controller(YandexOAuthController::class)->group(function (): void {
                Route::get('/yandex/authorization', 'availability');
                Route::post('/yandex/authorization', 'start')
                    ->middleware('throttle:10,1,'.YandexOAuthController::START_THROTTLE_PREFIX);
            });

            Route::controller(ConnectionController::class)->group(function (): void {
                Route::get('/', 'index');
                Route::post('/', 'store');
                Route::get('/{connection}/files', 'files');
                Route::delete('/{connection}', 'disconnect');
            });
        });

        Route::prefix('transfers')->controller(TransferController::class)->group(function (): void {
            Route::get('/', 'index');
            Route::post('/', 'store');
            Route::delete('/{transfer}', 'cancel');
        });

        Route::controller(LibraryController::class)->group(function (): void {
            Route::get('/folders', 'folders');
            Route::post('/folders', 'create');
            Route::delete('/folders/{folder}', 'removeFolder');
            Route::get('/tags', 'tags');
        });

        Route::get('/search', [DocumentController::class, 'index']);

        Route::prefix('documents')->group(function (): void {
            Route::post('/batch', [BatchController::class, 'store']);

            Route::controller(DocumentController::class)->group(function (): void {
                Route::post('/duplicates', 'duplicates');
                Route::get('/', 'index');
                Route::post('/', 'store');
                Route::post('/{id}/restore', 'restore');
                Route::delete('/{id}/purge', 'purge')->whereUuid('id');
            });

            Route::prefix('{document}')->group(function (): void {
                Route::controller(DocumentController::class)->group(function (): void {
                    Route::get('/', 'show');
                    Route::patch('/', 'update');
                    Route::delete('/', 'destroy');
                    Route::get('/versions', 'versions');
                    Route::post('/versions', 'addVersion');
                    Route::get('/draft/publication', 'draftStatus');
                    Route::post('/draft/publication', 'publishDraft');
                    Route::get('/participants', 'participants');
                    Route::get('/grants', 'grants');
                    Route::put('/grants', 'setGrants');
                });

                Route::controller(LibraryController::class)->group(function (): void {
                    Route::put('/folder', 'move');
                    Route::put('/tags', 'setTags');
                    Route::put('/favorite', 'favorite');
                });

                Route::controller(CommentController::class)->group(function (): void {
                    Route::get('/comments', 'index');
                    Route::post('/comments', 'store');
                });

                Route::post('/editor/session', [OfficeController::class, 'session']);
            });
        });

        Route::prefix('versions/{version}')->group(function (): void {
            Route::controller(DocumentController::class)->group(function (): void {
                Route::get('/download', 'download');
                Route::get('/entities', 'entities');
                Route::get('/text', 'text');
            });

            Route::get('/preview', [PreviewController::class, 'show']);
        });

        Route::prefix('comments/{id}')->controller(CommentController::class)->group(function (): void {
            Route::patch('/', 'update');
            Route::delete('/', 'destroy');
        });
    });
});
