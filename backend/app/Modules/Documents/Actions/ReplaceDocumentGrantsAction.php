<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Models\User;
use App\Modules\Audit\Services\AuditWriter;
use App\Modules\Documents\DTO\ReplaceDocumentGrantsData;
use App\Modules\Documents\Models\Document;
use App\Modules\Documents\Models\DocumentGrant;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class ReplaceDocumentGrantsAction
{
    public function __construct(private \App\Modules\Collaboration\Services\OfficeAccess $office)
    {
    }

    /** @return Collection<int, DocumentGrant> */
    public function handle(User $actor, Document $document, ReplaceDocumentGrantsData $data): Collection
    {
        return DB::transaction(function () use ($actor, $document, $data): Collection {
            $grants = new Collection(array_map(
                fn (array $grant): DocumentGrant => new DocumentGrant($grant),
                $data->grants,
            ));
            $participants = $this->lock($grants);

            foreach ($grants as $grant) {
                $violation = $grant->getPermissionViolation($participants->get($grant->user_id)->role);
                if ($violation !== null) {
                    abort(422, __($violation));
                }
            }

            $document = Document::query()
                ->whereKey($document->id)
                ->lockForUpdate()
                ->firstOrFail();

            abort_unless($document->revision === $data->revision, 409, 'Разрешения изменились. Обновите список и повторите действие.');
            $previous = $document->grants()->get()->keyBy('user_id');
            $next = $grants->keyBy('user_id');
            $changed = $previous->filter(fn ($grant, $id) => !isset($next[$id]) || collect(['read', 'comment', 'edit', 'export'])->contains(fn ($right) => $grant->$right && !$next[$id]->$right))->keys()->all();
            $this->office->revokeDocument($document->id, $changed);
            $document->grants()->delete();
            $document->grants()->saveMany($grants);
            $document->increment('revision');

            AuditWriter::record($actor->id, 'document.grants.updated', $document->id);

            return $grants->values();
        }, attempts: 3);
    }

    /**
     * @param Collection<array-key, DocumentGrant> $grants
     * @return Collection<int, User>
     */
    private function lock(Collection $grants): Collection
    {
        $participants = User::query()
            ->whereKey($grants->pluck('user_id')->all())
            ->orderBy('id')
            ->lockForUpdate()
            ->get(['id', 'role'])
            ->keyBy('id');

        $missing = [];
        foreach ($grants as $index => $grant) {
            if (! $participants->has($grant->user_id)) {
                $field = "grants.{$index}.user_id";
                $missing[$field] = __('validation.exists', ['attribute' => $field]);
            }
        }
        if ($missing !== []) {
            throw ValidationException::withMessages($missing);
        }

        return $participants;
    }
}
