<?php

declare(strict_types=1);

namespace App\Modules\Documents\Actions;

use App\Models\User;
use App\Modules\Documents\Models\Folder;
use Illuminate\Support\Facades\DB;

final class CreateFolderAction
{
    private const MAX_DEPTH = 5;

    public function handle(User $user, string $name, ?Folder $parent): Folder
    {
        $parentId = $parent?->id;

        return DB::transaction(function () use ($user, $name, $parentId): Folder {
            $ancestorId = $parentId;
            for ($depth = 1; $ancestorId !== null; $depth++) {
                $ancestor = Folder::query()
                    ->where('owner_id', $user->id)
                    ->whereKey($ancestorId)
                    ->lockForUpdate()
                    ->firstOrFail();

                abort_if($depth >= self::MAX_DEPTH, 422, __('documents.folder_depth_limit', [
                    'depth' => self::MAX_DEPTH,
                ]));

                $ancestorId = $ancestor->parent_id;
            }

            return Folder::query()->create([
                'owner_id' => $user->id,
                'parent_id' => $parentId,
                'name' => $name,
            ]);
        });
    }
}
