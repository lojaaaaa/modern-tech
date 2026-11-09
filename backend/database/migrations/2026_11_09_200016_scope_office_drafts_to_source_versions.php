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
        Schema::table('office_drafts', function (Blueprint $table): void {
            $table->dropPrimary();
            $table->primary(['document_id', 'source_version_id']);
        });
    }

    public function down(): void
    {
        // Restoring one draft per document must never discard preserved work.
        if (DB::table('office_drafts')->groupBy('document_id')->havingRaw('COUNT(*) > 1')->exists()) {
            throw new RuntimeException('Cannot roll back while a document has drafts from multiple source versions.');
        }

        Schema::table('office_drafts', function (Blueprint $table): void {
            $table->dropPrimary();
            $table->primary('document_id');
        });
    }
};
