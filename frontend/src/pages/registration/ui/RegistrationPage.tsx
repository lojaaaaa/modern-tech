import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRegister } from '@/features/session';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';

export const RegistrationPage = () => {
    const registration = useRegister();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    return (
        <div className="password-page">
            <section className="content-panel form-panel">
                <h1>Создать учётную запись</h1>
                <p className="muted">После регистрации подтвердите почту, чтобы загружать и редактировать документы.</p>
                <ErrorMessage error={registration.error} />
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        registration.mutate({ name, email, password, password_confirmation: confirmation });
                    }}
                >
                    <label>
                        Ваше имя
                        <input
                            autoComplete="name"
                            required
                            maxLength={120}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </label>
                    <label>
                        Электронная почта
                        <input
                            type="email"
                            autoComplete="email"
                            required
                            maxLength={255}
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                        />
                    </label>
                    <label>
                        Пароль
                        <input
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={12}
                            maxLength={128}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                    </label>
                    <label>
                        Повторите пароль
                        <input
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={12}
                            maxLength={128}
                            value={confirmation}
                            onChange={(event) => setConfirmation(event.target.value)}
                        />
                    </label>
                    <Button type="submit" disabled={registration.isPending}>
                        {registration.isPending ? 'Создаём…' : 'Создать учётную запись'}
                    </Button>
                </form>
                <Link className="back-link" to="/">
                    Уже есть аккаунт? Войти
                </Link>
            </section>
        </div>
    );
};
