<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('office_drafts', function (Blueprint $table): void {
            $table->foreignUuid('document_id')->primary()->constrained('documents')->cascadeOnDelete();
            $table->foreignUuid('source_version_id')->constrained('document_versions');
            $table->string('storage_key');
            $table->uuid('editor_key')->unique();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('office_drafts');
    }
};
