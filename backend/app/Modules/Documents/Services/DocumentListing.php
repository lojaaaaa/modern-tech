<?php

declare(strict_types=1);

namespace App\Modules\Documents\Services;

use App\Models\User;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentVersion;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

final class DocumentListing
{
    /** @param array<string,mixed> $filters
     * @return Builder<Document>
     */
    public function query(User $user, array $filters): Builder
    {
        $term = trim($filters['q'] ?? '');
        $query = Document::query()->visibleTo($user)->with(['owner', 'publishedVersion', 'desiredVersion', 'grants' => fn ($grants) => $grants->where('user_id', $user->id)]);
        if (! empty($filters['trash'])) {
            $query->onlyTrashed();
            if (! $user->isAdministrator()) {
                $query->where('owner_id', $user->id);
            }
        }
        if (! empty($filters['mine'])) {
            $query->where('owner_id', $user->id);
        }
        if (! empty($filters['favorite'])) {
            $query->whereIn('id', DB::table('document_favorites')->select('document_id')->where('user_id', $user->id));
        }
        if (! empty($filters['folder_id'])) {
            $query->where('owner_id', $user->id)->where('folder_id', $filters['folder_id']);
        }
        if (! empty($filters['tag_id'])) {
            $query->whereIn('id', DB::table('document_tags')->select('document_id')->where('tag_id', $filters['tag_id']));
        }
        if ($term !== '') {
            $query->whereNotNull('published_version_id');
        }
        $versionRelation = $term !== '' ? 'publishedVersion' : 'desiredVersion';
        if (! empty($filters['format'])) {
            $query->whereHas($versionRelation, fn ($v) => $v->whereRaw('lower(original_name) LIKE ?', ['%.'.$filters['format']]));
        }
        if (! empty($filters['status'])) {
            $query->whereHas($versionRelation, fn ($v) => $v->where('status', $filters['status']));
        }
        foreach (['created', 'updated'] as $date) {
            if (! empty($filters[$date.'_from'])) {
                $query->where($date.'_at', '>=', CarbonImmutable::parse($filters[$date.'_from'])->startOfDay());
            }
            if (! empty($filters[$date.'_to'])) {
                $query->where($date.'_at', '<', CarbonImmutable::parse($filters[$date.'_to'])->addDay()->startOfDay());
            }
        }
        if ($term !== '') {
            app(SearchDocuments::class)->apply($query, $term);
        }
        $sort = $filters['sort'] ?? ($term !== '' ? 'relevance' : 'updated_at');
        $direction = $filters['direction'] ?? 'desc';
        if ($sort !== 'relevance') {
            $query->reorder();
            if (in_array($sort, ['title', 'created_at', 'updated_at'], true)) {
                $query->orderBy('documents.'.$sort, $direction);
            } elseif ($sort === 'owner') {
                $query->orderBy(User::select('name')->whereColumn('users.id', 'documents.owner_id')->limit(1), $direction);
            } else {
                $versionColumn = $term !== '' ? 'documents.published_version_id' : 'documents.desired_version_id';
                $subquery = DocumentVersion::whereColumn('document_versions.id', $versionColumn);
                if ($sort === 'format') {
                    // The extension is the last segment, independent of filename length/case.
                    $subquery->selectRaw(DB::getDriverName() === 'pgsql' ? "lower(substring(original_name from '[^.]+$'))" : 'lower(mime)');
                } else {
                    $subquery->select($sort);
                }
                $query->orderBy($subquery->limit(1), $direction);
            }
        }

        return $query->orderByDesc('documents.updated_at')->orderBy('documents.id');
    }
}
