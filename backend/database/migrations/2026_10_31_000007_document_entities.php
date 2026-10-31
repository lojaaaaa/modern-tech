<?php

declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_entities', function (Blueprint $t): void {
            $t->id();
            $t->foreignUuid('version_id')->constrained('document_versions')->cascadeOnDelete();
            $t->string('type', 30);
            $t->text('value');
            $t->unsignedInteger('offset');
            $t->unsignedInteger('length');
            $t->string('source', 30)->default('rules-v1');
            $t->index(['version_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_entities');
    }
};
