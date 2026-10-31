import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, initializeCsrf } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
export const PasswordPage = () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const [email, setEmail] = useState(params.get('email') ?? '');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const mutation = useMutation({
        mutationFn: async () => {
            await initializeCsrf();
            return api('/auth/' + (token ? 'reset-password' : 'forgot-password'), {
                method: 'POST',
                body: JSON.stringify({
                    email,
                    ...(token ? { token, password, password_confirmation: confirmation } : {}),
                }),
            });
        },
    });
    return (
        <div className="password-page">
            <section className="content-panel form-panel">
                <h1>{token ? 'Новый пароль' : 'Восстановление доступа'}</h1>
                <ErrorMessage error={mutation.error} />
                {mutation.isSuccess ? (
                    <p role="status">
                        {token ? 'Пароль обновлён.' : 'Если учётная запись существует, письмо отправлено.'}
                    </p>
                ) : (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            mutation.mutate();
                        }}
                    >
                        <label>
                            Электронная почта
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="email"
                            />
                        </label>
                        {token && (
                            <>
                                <label>
                                    Новый пароль
                                    <input
                                        type="password"
                                        minLength={12}
                                        maxLength={128}
                                        required
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                </label>
                                <label>
                                    Повторите пароль
                                    <input
                                        type="password"
                                        required
                                        minLength={12}
                                        maxLength={128}
                                        autoComplete="new-password"
                                        value={confirmation}
                                        onChange={(e) => setConfirmation(e.target.value)}
                                    />
                                </label>
                            </>
                        )}
                        <Button disabled={mutation.isPending}>{token ? 'Сохранить пароль' : 'Отправить ссылку'}</Button>
                    </form>
                )}
                <a className="back-link" href="/">
                    Вернуться ко входу
                </a>
            </section>
        </div>
    );
};
