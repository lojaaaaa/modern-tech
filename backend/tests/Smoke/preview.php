<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use App\Modules\Processing\Jobs\GeneratePreview;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('local', 'testing')) {
    throw new RuntimeException('Local smoke only');
}
$temporary = tempnam(sys_get_temp_dir(), 'preview-fixture-');
$zip = new ZipArchive;
$zip->open($temporary, ZipArchive::OVERWRITE);
$zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
$zip->addFromString('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
$zip->addFromString('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Modern Tech preview smoke</w:t></w:r></w:p></w:body></w:document>');
$zip->close();
$key = 'smoke/'.Str::uuid().'.docx';
$preview = null;
DB::beginTransaction();
try {
    Storage::disk('local')->put($key, file_get_contents($temporary));
    $user = User::create(['name' => 'Preview smoke', 'email' => Str::uuid().'@example.invalid', 'password' => Str::random(40), 'role' => 'employee', 'active' => true]);
    $doc = Document::create(['owner_id' => $user->id, 'title' => 'Preview smoke']);
    $version = DocumentVersion::create(['document_id' => $doc->id, 'creator_id' => $user->id, 'number' => 1, 'storage_key' => $key, 'original_name' => 'fixture.docx', 'mime' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'size' => filesize($temporary), 'sha256' => hash_file('sha256', $temporary), 'status' => 'ready']);
    (new GeneratePreview($version->id))->handle();
    $preview = $version->fresh()->preview_key;
    if (! $preview || ! str_starts_with(Storage::disk('local')->get($preview), '%PDF-')) {
        throw new RuntimeException('Preview smoke failed');
    }
    echo "PASS: real Gotenberg DOCX to PDF preview.\n";
} finally {
    DB::rollBack();
    Storage::disk('local')->delete($key);
    if ($preview) {
        Storage::disk('local')->delete($preview);
    }
    unlink($temporary);
}
