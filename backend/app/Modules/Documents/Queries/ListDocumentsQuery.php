<?php

declare(strict_types=1);

namespace App\Modules\Documents\Queries;

use App\Models\User;
use App\Modules\Documents\DTO\DocumentListFilters;
use App\Modules\Documents\Enums\DocumentVersionStatus;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

final class ListDocumentsQuery
{
    public function __construct(private SearchDocumentsQuery $search)
    {
    }

    /** @return LengthAwarePaginator<int, Document> */
    public function handle(User $user, DocumentListFilters $filters): LengthAwarePaginator
    {
        $query = Document::query()
            ->visibleTo($user)
            ->withLibraryRelations($user)
            ->when($filters->isTrash, fn (Builder $query) => $query->onlyTrashed())
            ->when(
                $filters->isMine || ($filters->isTrash && ! $user->isAdministrator()) || $filters->folderId !== null,
                fn (Builder $query) => $query->where('owner_id', $user->id),
            )
            ->when($filters->isFavorite, fn (Builder $query) => $query->whereIn(
                'id',
                DB::table('document_favorites')->select('document_id')->where('user_id', $user->id),
            ))
            ->when($filters->folderId !== null, fn (Builder $query) => $query->where('folder_id', $filters->folderId))
            ->when($filters->tagId !== null, fn (Builder $query) => $query->whereIn(
                'id',
                DB::table('document_tags')->select('document_id')->where('tag_id', $filters->tagId),
            ));

        $version = DocumentVersion::query()->whereColumn(
            'document_versions.id',
            $filters->term === null ? 'documents.desired_version_id' : 'documents.published_version_id',
        );
        if ($filters->format !== null || $filters->status !== null) {
            $query->whereExists(
                (clone $version)
                    ->selectRaw('1')
                    ->when(
                        $filters->format,
                        fn (Builder $version, string $format) => $version->whereLike('original_name', '%.' . $format),
                    )
                    ->when(
                        $filters->status,
                        fn (Builder $version, DocumentVersionStatus $status) =>
                            $version->where('status', $status->value),
                    ),
            );
        }

        $this->applyDateRange($query, 'created_at', $filters->createdFrom, $filters->createdTo);
        $this->applyDateRange($query, 'updated_at', $filters->updatedFrom, $filters->updatedTo);

        if ($filters->term !== null) {
            $this->search->apply($query, $filters->term);
        }

        $this->applySort($query, $filters, $version);

        return $query
            ->orderByDesc('documents.updated_at')
            ->orderBy('documents.id')
            ->paginate(perPage: $filters->perPage, page: $filters->page);
    }

    /** @param Builder<Document> $query */
    private function applyDateRange(Builder $query, string $column, ?string $from, ?string $to): void
    {
        if ($from !== null) {
            $query->where($column, '>=', CarbonImmutable::parse($from)->startOfDay());
        }
        if ($to !== null) {
            $query->where($column, '<', CarbonImmutable::parse($to)->addDay()->startOfDay());
        }
    }

    /**
     * @param Builder<Document> $query
     * @param Builder<DocumentVersion> $version
     */
    private function applySort(Builder $query, DocumentListFilters $filters, Builder $version): void
    {
        if ($filters->sort === 'relevance') {
            return;
        }

        $column = match ($filters->sort) {
            'title', 'created_at', 'updated_at' => 'documents.' . $filters->sort,
            'owner' => User::query()->select('name')->whereColumn('users.id', 'documents.owner_id')->limit(1),
            'format' => $version->selectRaw("lower(substring(original_name from '[^.]+$'))"),
            'size', 'status' => $version->select($filters->sort),
            default => throw new InvalidArgumentException('Unsupported document sort field: ' . $filters->sort),
        };

        $query->reorder($column, $filters->direction);
    }
}
