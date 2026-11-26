<?php

declare(strict_types=1);

namespace App\Modules\Integrations\Actions;

use App\Models\User;
use App\Modules\Identity\Enums\UserRole;
use App\Modules\Integrations\Enums\CloudConnectionStatus;
use App\Modules\Integrations\Enums\CloudProviderId;
use App\Modules\Integrations\Models\CloudConnection;
use App\Modules\Integrations\Services\CloudFailure;
use App\Modules\Integrations\Services\GoogleDisk;
use App\Modules\Integrations\Services\GoogleOAuth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class ConnectGoogleDiskAction
{
    public function __construct(private readonly GoogleOAuth $oauth)
    {
    }

    /** @param array<string, mixed> $pending */
    public function handle(User $user, string $code, array $pending): CloudConnection
    {
        $credentials = $this->oauth->exchangeCode($code, $pending['verifier']);
        $account = (new GoogleDisk($credentials['token']))->getAccount();
        $credentials['account_id'] = $account['id'];
        $name = $account['label'] === null ? 'Google Drive' : 'Google Drive · ' . Str::limit($account['label'], 75, '');

        return DB::transaction(function () use ($user, $pending, $credentials, $name): CloudConnection {
            $actor = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            if (! $actor->isActive() || $actor->role === UserRole::OBSERVER || ! hash_equals($pending['password'], hash('sha256', $actor->getAuthPassword()))) {
                throw new CloudFailure('ACCESS_REVOKED');
            }
            $connections = CloudConnection::query()
                ->ownedBy($actor)
                ->where('provider', CloudProviderId::GOOGLE->value)
                ->lockForUpdate()
                ->get();
            if ($pending['connection_id']) {
                $connection = $connections->firstWhere('id', $pending['connection_id']);
                if (! $connection || ! hash_equals($pending['connection_fingerprint'], $connection->getCredentialsFingerprint())
                    || (isset($connection->credentials['account_id']) && $connection->credentials['account_id'] !== $credentials['account_id'])) {
                    throw new CloudFailure('ACCESS_REVOKED');
                }
            } else {
                $connection = $connections->first(fn (CloudConnection $item) => ($item->credentials['account_id'] ?? null) === $credentials['account_id']);
            }
            $connection ??= new CloudConnection(['owner_id' => $actor->id, 'provider' => CloudProviderId::GOOGLE->value, 'name' => $name]);
            $connection->fill(['credentials' => $credentials, 'status' => CloudConnectionStatus::CONNECTED])->save();

            return $connection;
        });
    }
}
