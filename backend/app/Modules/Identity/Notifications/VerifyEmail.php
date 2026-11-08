<?php

declare(strict_types=1);

namespace App\Modules\Identity\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail as FrameworkVerifyEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;

final class VerifyEmail extends FrameworkVerifyEmail implements ShouldQueue
{
    use Queueable;

    public function __construct()
    {
        $this->onQueue('short');
        $this->afterCommit();
    }

    public function toMail($notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Подтвердите электронную почту — Modern Tech')
            ->greeting('Здравствуйте!')
            ->line('Подтвердите адрес, чтобы загружать документы, редактировать их и добавлять комментарии.')
            ->action('Подтвердить электронную почту', $this->verificationUrl($notifiable))
            ->line('Ссылка действует 60 минут. Если срок истёк, запросите новое письмо в приложении.')
            ->line('Если вы не создавали учётную запись, проигнорируйте это письмо.');
    }
}
