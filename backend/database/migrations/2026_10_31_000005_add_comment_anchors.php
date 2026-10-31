<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_comments', function (Blueprint $table): void {
            $table->unsignedInteger('anchor_start')->nullable();
            $table->unsignedInteger('anchor_end')->nullable();
            $table->text('anchor_quote')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('document_comments', fn (Blueprint $table) => $table->dropColumn(['anchor_start', 'anchor_end', 'anchor_quote']));
    }
};
