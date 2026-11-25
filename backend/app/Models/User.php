<?php

declare(strict_types=1);

namespace App\Models;

use App\Modules\Identity\Enums\UserRole;
use App\Modules\Identity\Notifications\ResetPassword;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory;
    use Notifiable;

    protected $fillable = ['name', 'email', 'password', 'role', 'active'];

    protected $hidden = ['password', 'remember_token', 'email_verified_at'];

    protected function casts(): array
    {
        return ['password' => 'hashed', 'active' => 'boolean', 'role' => UserRole::class];
    }

    /** @return Attribute<string, string> */
    protected function email(): Attribute
    {
        return Attribute::make(set: fn (string $value): string => Str::lower(trim($value)));
    }

    public function sendPasswordResetNotification($token): void
    {
        $this->notify(new ResetPassword($token));
    }

    public function isActive(): bool
    {
        return $this->active === true;
    }

    public function isAdministrator(): bool
    {
        return $this->isActive() && $this->role === UserRole::ADMIN;
    }
}
