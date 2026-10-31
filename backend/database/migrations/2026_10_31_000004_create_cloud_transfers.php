<?php

declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cloud_connections', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignId('owner_id')->constrained('users');
            $t->string('provider', 20);
            $t->string('name', 100);
            $t->text('credentials');
            $t->string('status', 30)->default('connected');
            $t->timestamps();
        });
        Schema::create('cloud_transfers', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignId('initiator_id')->constrained('users');
            $t->foreignUuid('connection_id')->constrained('cloud_connections');
            $t->foreignUuid('version_id')->nullable()->constrained('document_versions');
            $t->string('direction', 10);
            $t->text('remote_path');
            $t->string('filename');
            $t->string('status', 30)->default('queued');
            $t->string('error_code')->nullable();
            $t->uuid('document_id')->nullable();
            $t->timestamps();
            $t->index(['initiator_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cloud_transfers');
        Schema::dropIfExists('cloud_connections');
    }
};
