<?php

declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_comments', fn (Blueprint $t) => $t->timestamp('resolved_at')->nullable());
    }

    public function down(): void
    {
        Schema::table('document_comments', fn (Blueprint $t) => $t->dropColumn('resolved_at'));
    }
};
