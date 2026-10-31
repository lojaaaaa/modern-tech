<?php

declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_versions', function (Blueprint $t): void {
            $t->unsignedInteger('processing_attempts')->default(0);
            $t->timestamp('processing_started_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('document_versions', fn (Blueprint $t) => $t->dropColumn(['processing_attempts', 'processing_started_at']));
    }
};
