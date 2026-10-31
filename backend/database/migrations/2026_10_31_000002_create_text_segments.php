<?php

declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('text_segments', function (Blueprint $t): void {
            $t->id();
            $t->foreignUuid('version_id')->constrained('document_versions')->cascadeOnDelete();
            $t->unsignedInteger('ordinal');
            $t->text('content');
            $t->unique(['version_id', 'ordinal']);
        });
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE text_segments ADD COLUMN search_ru tsvector GENERATED ALWAYS AS (to_tsvector('russian', content)) STORED");
            DB::statement("ALTER TABLE text_segments ADD COLUMN search_en tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED");
            DB::statement('CREATE INDEX text_segments_ru_gin ON text_segments USING GIN(search_ru)');
            DB::statement('CREATE INDEX text_segments_en_gin ON text_segments USING GIN(search_en)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('text_segments');
    }
};
