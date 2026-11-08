import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResendVerification, useSession } from '@/features/session';
import type { User } from '@/shared/api/types';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';

export const VerificationPage = ({ user }: { user: User }) => {
    const resend = useResendVerification();
    const session = useSession();
    const [checked, setChecked] = useState(false);
    if (user.email_verified_at) {
        return (
            <section className="content-panel form-panel">
                <h1>Электронная почта подтверждена</h1>
                <Link to="/">Перейти к библиотеке</Link>
            </section>
        );
    }
    return (
        <section className="content-panel form-panel verification-panel">
            <h1>Подтвердите электронную почту</h1>
            <p>
                Откройте письмо для <strong>{user.email}</strong> и нажмите ссылку подтверждения.
            </p>
            <p className="muted">
                До подтверждения можно входить и читать доступные документы. Загрузка, редактирование и комментарии
                будут доступны после подтверждения адреса.
            </p>
            <ErrorMessage error={resend.error ?? session.error} />
            {resend.isSuccess && <p role="status">{resend.data.data.message}</p>}
            {checked && !session.isFetching && (
                <p role="status">Адрес ещё не подтверждён. Откройте ссылку из письма или запросите новое письмо.</p>
            )}
            <div className="action-group">
                <Button onClick={() => resend.mutate()} disabled={resend.isPending}>
                    {resend.isPending ? 'Отправляем…' : 'Отправить письмо ещё раз'}
                </Button>
                <Button
                    variant="secondary"
                    disabled={session.isFetching}
                    onClick={async () => {
                        await session.refetch();
                        setChecked(true);
                    }}
                >
                    Проверить подтверждение
                </Button>
            </div>
            <p>
                <Link to="/">Перейти к библиотеке</Link>
            </p>
        </section>
    );
};
