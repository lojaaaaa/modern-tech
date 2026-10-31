<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('role', 20)->default('employee');
            $table->boolean('active')->default(true);
        });
        Schema::create('folders', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignId('owner_id')->constrained('users');
            $t->uuid('parent_id')->nullable();
            $t->string('name', 120);
            $t->timestamps();
        });
        Schema::table('folders', function (Blueprint $t): void {
            $t->foreign('parent_id')->references('id')->on('folders');
        });
        Schema::create('documents', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignId('owner_id')->constrained('users');
            $t->foreignUuid('folder_id')->nullable()->constrained('folders')->nullOnDelete();
            $t->string('title');
            $t->unsignedBigInteger('revision')->default(1);
            $t->uuid('desired_version_id')->nullable();
            $t->uuid('published_version_id')->nullable();
            $t->timestamps();
            $t->softDeletes();
            $t->timestamp('purge_after')->nullable();
            $t->index(['owner_id', 'deleted_at']);
        });
        Schema::create('document_versions', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('document_id')->constrained()->cascadeOnDelete();
            $t->foreignId('creator_id')->constrained('users');
            $t->unsignedInteger('number');
            $t->string('storage_key');
            $t->string('original_name');
            $t->string('mime', 150);
            $t->unsignedBigInteger('size');
            $t->char('sha256', 64);
            $t->string('status', 32)->default('quarantined');
            $t->string('error_code')->nullable();
            $t->text('extracted_text')->nullable();
            $t->string('preview_key')->nullable();
            $t->timestamps();
            $t->unique(['document_id', 'number']);
        });
        Schema::create('document_grants', function (Blueprint $t): void {
            $t->id();
            $t->foreignUuid('document_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            foreach (['read', 'comment', 'edit', 'export'] as $permission) {
                $t->boolean($permission)->default(false);
            }
            $t->timestamps();
            $t->unique(['document_id', 'user_id']);
        });
        Schema::create('document_comments', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('document_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('version_id')->constrained('document_versions');
            $t->foreignId('author_id')->constrained('users');
            $t->uuid('parent_id')->nullable();
            $t->text('body');
            $t->unsignedInteger('revision')->default(1);
            $t->timestamps();
            $t->softDeletes();
        });
        Schema::table('document_comments', function (Blueprint $t): void {
            $t->foreign('parent_id')->references('id')->on('document_comments');
        });
        Schema::create('document_favorites', function (Blueprint $t): void {
            $t->foreignUuid('document_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->primary(['document_id', 'user_id']);
        });
        Schema::create('audit_events', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignId('actor_id')->nullable()->constrained('users');
            $t->string('action');
            $t->string('resource_id')->nullable();
            $t->json('metadata');
            $t->timestamp('created_at');
            $t->index(['created_at', 'actor_id']);
        });
        Schema::create('outbox_events', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->string('type');
            $t->json('payload');
            $t->timestamp('dispatched_at')->nullable();
            $t->timestamps();
            $t->index(['dispatched_at', 'created_at']);
        });
        Schema::create('idempotency_records', function (Blueprint $t): void {
            $t->id();
            $t->foreignId('user_id')->constrained();
            $t->string('scope', 100);
            $t->string('key', 100);
            $t->char('request_hash', 64);
            $t->uuid('resource_id');
            $t->timestamps();
            $t->unique(['user_id', 'scope', 'key']);
        });

    }

    public function down(): void
    {
        foreach (['idempotency_records', 'outbox_events', 'audit_events', 'document_favorites', 'document_comments', 'document_grants', 'document_versions', 'documents', 'folders'] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['role', 'active']));
    }
};
