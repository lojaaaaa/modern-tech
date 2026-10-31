<?php

declare(strict_types=1);

use App\Models\User;
use GuzzleHttp\Cookie\CookieJar;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('local', 'testing')) {
    throw new RuntimeException('Smoke check is limited to local/testing environments.');
}
$password = bin2hex(random_bytes(24));
$user = User::create(['name' => 'Session smoke', 'email' => 'session-'.bin2hex(random_bytes(8)).'@example.invalid', 'password' => $password, 'role' => 'employee', 'active' => true]);
$jar = new CookieJar;
$http = Http::baseUrl('http://gateway')->acceptJson()->timeout(15)->withOptions(['cookies' => $jar, 'allow_redirects' => false]);
$assert = function (bool $condition, string $message): void {
    if (! $condition) {
        throw new RuntimeException($message);
    }
};
try {
    $credentials = ['email' => $user->email, 'password' => $password];
    $assert($http->post('/api/v1/auth/login', $credentials)->status() === 419, 'Missing CSRF must fail.');
    $assert($http->get('/sanctum/csrf-cookie')->status() === 204, 'CSRF initialization failed.');
    $token = urldecode($jar->getCookieByName('XSRF-TOKEN')->getValue());
    $sessionName = config('session.cookie');
    $oldSession = $jar->getCookieByName($sessionName)->getValue();
    $login = $http->replaceHeaders(['Accept' => 'application/json', 'X-XSRF-TOKEN' => $token])->post('/api/v1/auth/login', $credentials);
    $assert($login->successful(), 'Real HTTP login failed: '.$login->status());
    $assert($oldSession !== $jar->getCookieByName($sessionName)->getValue(), 'Session cookie was not rotated.');
    $assert($http->get('/api/v1/me')->json('data.id') === $user->id, 'Authenticated session is unavailable.');
    $token = urldecode($jar->getCookieByName('XSRF-TOKEN')->getValue());
    $assert($http->replaceHeaders(['Accept' => 'application/json', 'X-XSRF-TOKEN' => $token])->post('/api/v1/auth/logout')->successful(), 'Logout failed.');
    $assert($http->get('/api/v1/me')->status() === 401, 'Logout did not revoke the session.');
    echo "PASS: real HTTP CSRF rejection, login, cookie rotation, authenticated request and logout.\n";
} finally {
    DB::table('sessions')->where('user_id', $user->id)->delete();
    $user->delete();
}
