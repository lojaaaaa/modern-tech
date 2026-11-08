<?php

declare(strict_types=1);

namespace App\Modules\Identity\Notifications;

use Illuminate\Auth\Notifications\ResetPassword as FrameworkResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;

final class ResetPassword extends FrameworkResetPassword implements ShouldQueue
{
    use Queueable;

    public function __construct(string $token)
    {
        parent::__construct($token);
        $this->onQueue('short');
        $this->afterCommit();
    }

    public function toMail($notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Восстановление доступа — Modern Tech')
            ->greeting('Здравствуйте!')
            ->line('Для этой учётной записи запрошен новый пароль.')
            ->action('Установить новый пароль', $this->resetUrl($notifiable))
            ->line('Ссылка действует 60 минут и может быть использована один раз. После смены пароля потребуется снова войти на всех устройствах.')
            ->line('Если вы не запрашивали новый пароль, проигнорируйте письмо.');
    }
}
