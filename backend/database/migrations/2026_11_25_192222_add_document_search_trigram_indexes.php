<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class () extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        DB::statement('CREATE INDEX documents_title_trgm ON documents USING GIN (lower(title) gin_trgm_ops)');
        DB::statement('CREATE INDEX document_versions_text_trgm ON document_versions USING GIN (lower(extracted_text) gin_trgm_ops) WHERE extracted_text IS NOT NULL');
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS documents_title_trgm, document_versions_text_trgm');
        }
    }
};
