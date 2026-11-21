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
use App\Modules\Identity\Http\Controllers\EmailVerificationController;
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
        ->middleware('throttle:60,1,' . YandexOAuthController::CALLBACK_THROTTLE_PREFIX);
    Route::get('/office/source/{capability}', [OfficeController::class, 'source'])->where('capability', '[A-Za-z0-9._-]+');
    Route::post('/office/callback', [OfficeController::class, 'callback']);
    Route::post('/auth/register', [RegistrationController::class, 'store'])
        ->middleware('throttle:' . AppServiceProvider::REGISTRATION_LIMITER);
    Route::post('/auth/forgot-password', [PasswordController::class, 'forgot'])
        ->middleware('throttle:3,15,' . PasswordController::FORGOT_THROTTLE_PREFIX);
    Route::post('/auth/reset-password', [PasswordController::class, 'reset'])
        ->middleware('throttle:10,1,' . PasswordController::RESET_THROTTLE_PREFIX);
    Route::post('/auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:' . AppServiceProvider::LOGIN_LIMITER);
    Route::middleware(['auth', EnsureActive::class, 'auth.session'])->group(function (): void {
        Route::post('/auth/verification-notification', [EmailVerificationController::class, 'store'])
            ->middleware('throttle:' . AppServiceProvider::VERIFICATION_LIMITER);
        Route::get('/auth/verify-email/{id}/{hash}', [EmailVerificationController::class, 'show'])->whereNumber('id')->middleware('signed')->name('verification.verify');
        Route::get('/admin/metrics', MetricsController::class);
        Route::get('/connections', [ConnectionController::class, 'index']);
        Route::get('/connections/yandex/authorization', [YandexOAuthController::class, 'availability']);
        Route::post('/connections/yandex/authorization', [YandexOAuthController::class, 'start'])
            ->middleware('throttle:10,1,' . YandexOAuthController::START_THROTTLE_PREFIX);
        Route::post('/connections', [ConnectionController::class, 'store']);
        Route::get('/connections/{connection}/files', [ConnectionController::class, 'files']);
        Route::delete('/connections/{connection}', [ConnectionController::class, 'disconnect']);
        Route::get('/transfers', [TransferController::class, 'index']);
        Route::post('/transfers', [TransferController::class, 'store']);
        Route::delete('/transfers/{transfer}', [TransferController::class, 'cancel']);
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/users', [UserController::class, 'index']);
        Route::post('/users', [UserController::class, 'store']);
        Route::patch('/users/{user}', [UserController::class, 'update']);
        Route::get('/folders', [LibraryController::class, 'folders']);
        Route::post('/folders', [LibraryController::class, 'create']);
        Route::delete('/folders/{folder}', [LibraryController::class, 'removeFolder']);
        Route::get('/tags', [LibraryController::class, 'tags']);
        Route::put('/documents/{document}/folder', [LibraryController::class, 'move']);
        Route::put('/documents/{document}/tags', [LibraryController::class, 'setTags']);
        Route::put('/documents/{document}/favorite', [LibraryController::class, 'favorite']);
        Route::post('/documents/batch', [BatchController::class, 'store']);
        Route::post('/documents/duplicates', [DocumentController::class, 'duplicates']);
        Route::get('/documents', [DocumentController::class, 'index']);
        Route::get('/search', [DocumentController::class, 'index']);
        Route::post('/documents', [DocumentController::class, 'store']);
        Route::post('/documents/{document}/editor/session', [OfficeController::class, 'session']);
        Route::get('/documents/{document}', [DocumentController::class, 'show']);
        Route::patch('/documents/{document}', [DocumentController::class, 'update']);
        Route::delete('/documents/{document}', [DocumentController::class, 'destroy']);
        Route::post('/documents/{id}/restore', [DocumentController::class, 'restore']);
        Route::get('/documents/{document}/versions', [DocumentController::class, 'versions']);
        Route::post('/documents/{document}/versions', [DocumentController::class, 'addVersion']);
        Route::get('/versions/{version}/download', [DocumentController::class, 'download']);
        Route::get('/versions/{version}/preview', [PreviewController::class, 'show']);
        Route::get('/versions/{version}/entities', [DocumentController::class, 'entities']);
        Route::get('/versions/{version}/text', [DocumentController::class, 'text']);
        Route::get('/documents/{document}/participants', [DocumentController::class, 'participants']);
        Route::get('/documents/{document}/grants', [DocumentController::class, 'grants']);
        Route::put('/documents/{document}/grants', [DocumentController::class, 'setGrants']);
        Route::get('/documents/{document}/comments', [CommentController::class, 'index']);
        Route::post('/documents/{document}/comments', [CommentController::class, 'store']);
        Route::put('/comments/{id}/resolution', [CommentController::class, 'resolve']);
        Route::patch('/comments/{id}', [CommentController::class, 'update']);
        Route::delete('/comments/{id}', [CommentController::class, 'destroy']);
        Route::get('/admin/audit', [AuditController::class, 'index']);
    });
});
