<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Documents\Services\UploadDocument;
use App\Modules\Processing\Jobs\ProcessVersion;
use Illuminate\Contracts\Console\Kernel;
use App\Modules\Documents\Services\IncomingFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('local', 'testing')) {
    throw new RuntimeException('Smoke check is limited to local/testing environments.');
}
$temporary = tempnam(sys_get_temp_dir(), 'pipeline-smoke-');
$stored = null;
DB::beginTransaction();
try {
    file_put_contents($temporary, 'Контрольный документ: управление архивом. Reliable searchable archive.');
    $user = User::create(['name' => 'Smoke test', 'email' => 'smoke-'.bin2hex(random_bytes(8)).'@example.invalid', 'password' => bin2hex(random_bytes(32)), 'role' => 'employee', 'active' => true]);
    $document = app(UploadDocument::class)->execute($user, new IncomingFile($temporary, 'smoke.txt'), null, 'smoke-test');
    $version = $document->versions()->firstOrFail();
    $stored = $version->storage_key;
    app()->call([new ProcessVersion($version->id), 'handle']);
    if ($version->fresh()->status !== 'ready' || $document->fresh()->published_version_id !== $version->id) {
        throw new RuntimeException('Pipeline failed to publish the version.');
    }
    $found = DB::table('text_segments')->where('version_id', $version->id)->whereRaw("search_ru @@ websearch_to_tsquery('russian', ?)", ['документов'])->exists();
    if (! $found) {
        throw new RuntimeException('PostgreSQL full-text search failed.');
    }
    echo "PASS: actual ClamAV → Tika → PostgreSQL indexing/publication/search.\n";
} finally {
    DB::rollBack();
    if ($stored !== null) {
        Storage::disk('local')->delete($stored);
    }
    if (is_string($temporary) && is_file($temporary)) {
        unlink($temporary);
    }
}
