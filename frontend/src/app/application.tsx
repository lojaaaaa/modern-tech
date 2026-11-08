import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom';
import { client } from './query-client';
import {
    Files,
    Cloud,
    Trash2,
    Users,
    Activity,
    LogOut,
    Moon,
    Sun,
    Layers3,
    ArrowRight,
    PanelLeftClose,
    PanelLeftOpen,
} from 'lucide-react';
import { useSession, useLogin, useLogout, replaceSession } from '@/features/session';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { useTheme } from './theme';

const LibraryPage = lazy(() => import('@/pages/library').then((module) => ({ default: module.LibraryPage })));
const IntegrationsPage = lazy(() =>
    import('@/pages/integrations').then((module) => ({ default: module.IntegrationsPage }))
);
const DocumentPage = lazy(() => import('@/pages/document').then((module) => ({ default: module.DocumentPage })));
const UsersPage = lazy(() => import('@/pages/admin').then((module) => ({ default: module.UsersPage })));
const AuditPage = lazy(() => import('@/pages/admin').then((module) => ({ default: module.AuditPage })));
const PasswordPage = lazy(() => import('@/pages/password').then((module) => ({ default: module.PasswordPage })));
const RegistrationPage = lazy(() =>
    import('@/pages/registration').then((module) => ({ default: module.RegistrationPage }))
);
const VerificationPage = lazy(() =>
    import('@/pages/registration').then((module) => ({ default: module.VerificationPage }))
);

export const App = () => {
    const location = useLocation();
    const session = useSession();
    const logout = useLogout();
    const dark = useTheme((s) => s.dark);
    const toggle = useTheme((s) => s.toggle);
    const [menu, setMenu] = useState(false);
    useEffect(() => {
        document.documentElement.classList.toggle('dark', dark);
    }, [dark]);
    useEffect(() => {
        const expired = () => {
            replaceSession(client, null);
        };
        window.addEventListener('session-expired', expired);
        return () => window.removeEventListener('session-expired', expired);
    }, []);
    if (session.isPending) {
        return (
            <div className="app-loading">
                <Layers3 size={34} />
                <p>Открываем рабочее пространство…</p>
            </div>
        );
    }
    const user = session.data?.data;
    if (['/forgot-password', '/reset-password'].includes(location.pathname)) {
        return (
            <Suspense
                fallback={
                    <div className="empty-state" role="status">
                        Загрузка…
                    </div>
                }
            >
                <PasswordPage />
            </Suspense>
        );
    }
    if (!user) {
        if (location.pathname === '/register') {
            return (
                <Suspense
                    fallback={
                        <div className="empty-state" role="status">
                            Загрузка…
                        </div>
                    }
                >
                    <RegistrationPage />
                </Suspense>
            );
        }
        return <Login />;
    }
    const pageNames: Record<string, string> = {
        '/': 'Документы',
        '/trash': 'Корзина',
        '/integrations': 'Облачные диски',
        '/users': 'Команда',
        '/audit': 'Журнал действий',
        '/verify-email': 'Подтверждение почты',
    };
    const pageName = location.pathname.startsWith('/documents/')
        ? 'Документ'
        : (pageNames[location.pathname] ?? 'Документы');
    return (
        <div key={user.id} className="app-shell">
            <a className="skip-link" href="#main-content">
                Перейти к содержимому
            </a>
            {menu && (
                <button className="mobile-nav-backdrop" aria-label="Закрыть меню" onClick={() => setMenu(false)} />
            )}
            <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
                <NavLink to="/" className="brand">
                    <span>
                        <Layers3 size={21} />
                    </span>
                    <div>
                        modern<span>tech</span>
                        <small>ДОКУМЕНТЫ КОМАНДЫ</small>
                    </div>
                </NavLink>
                <div className="nav-label">Библиотека</div>
                <nav aria-label="Библиотека">
                    <NavLink to="/" end onClick={() => setMenu(false)}>
                        <Files size={18} />
                        Все документы
                    </NavLink>
                    <NavLink to="/trash" onClick={() => setMenu(false)}>
                        <Trash2 size={18} />
                        Корзина
                    </NavLink>
                    {user.role !== 'observer' && (
                        <NavLink to="/integrations" onClick={() => setMenu(false)}>
                            <Cloud size={18} />
                            Облачные диски
                        </NavLink>
                    )}
                </nav>
                {user.role === 'admin' && (
                    <>
                        <div className="nav-label">Управление</div>
                        <nav aria-label="Управление">
                            <NavLink to="/users" onClick={() => setMenu(false)}>
                                <Users size={18} />
                                Команда
                            </NavLink>
                            <NavLink to="/audit" onClick={() => setMenu(false)}>
                                <Activity size={18} />
                                Журнал действий
                            </NavLink>
                        </nav>
                    </>
                )}
                <div className="sidebar-bottom">
                    <div className="user-card">
                        <span className="avatar">{user.name.slice(0, 1)}</span>
                        <div>
                            <strong>{user.name}</strong>
                            <small>
                                {{ admin: 'Администратор', employee: 'Сотрудник', observer: 'Наблюдатель' }[user.role]}
                            </small>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Выйти"
                            onClick={() => logout.mutate()}
                            disabled={logout.isPending}
                        >
                            <LogOut size={16} />
                        </Button>
                    </div>
                </div>
            </aside>
            <div className="workspace-main">
                <header className="topbar">
                    <div>
                        <Button
                            className="menu-toggle"
                            variant="ghost"
                            size="icon"
                            aria-label="Меню"
                            aria-expanded={menu}
                            onClick={() => setMenu(!menu)}
                        >
                            {menu ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
                        </Button>
                        <span className="topbar-section">{pageName}</span>
                    </div>
                    <div>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={dark ? 'Светлая тема' : 'Тёмная тема'}
                            onClick={toggle}
                        >
                            {dark ? <Sun size={18} /> : <Moon size={18} />}
                        </Button>
                    </div>
                </header>
                <main id="main-content" tabIndex={-1}>
                    {user.email_verified_at === null && location.pathname !== '/verify-email' && (
                        <div className="verification-banner" role="status">
                            <span>Подтвердите email перед загрузкой, редактированием и комментированием.</span>
                            <Link to="/verify-email">Подтвердить электронную почту</Link>
                        </div>
                    )}
                    <Suspense
                        fallback={
                            <div className="empty-state" role="status">
                                Загрузка…
                            </div>
                        }
                    >
                        <Routes>
                            <Route
                                path="/register"
                                element={<Navigate to={user.email_verified_at ? '/' : '/verify-email'} replace />}
                            />
                            <Route path="/verify-email" element={<VerificationPage user={user} />} />
                            <Route path="/" element={<LibraryPage key={`documents:${user.id}`} user={user} />} />
                            <Route path="/trash" element={<LibraryPage key={`trash:${user.id}`} user={user} trash />} />
                            <Route
                                path="/integrations"
                                element={user.role !== 'observer' ? <IntegrationsPage /> : <Navigate to="/" replace />}
                            />
                            <Route path="/documents/:id" element={<DocumentPage />} />
                            <Route
                                path="/users"
                                element={user.role === 'admin' ? <UsersPage /> : <Navigate to="/" replace />}
                            />
                            <Route
                                path="/audit"
                                element={user.role === 'admin' ? <AuditPage /> : <Navigate to="/" replace />}
                            />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </Suspense>
                </main>
            </div>
        </div>
    );
};
const Login = () => {
    const login = useLogin();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    return (
        <div className="login-page">
            <section className="login-story">
                <div className="brand light">
                    <span>
                        <Layers3 size={24} />
                    </span>
                    <div>
                        modern<span>tech</span>
                    </div>
                </div>
                <div>
                    <span className="story-eyebrow">Работа с документами</span>
                    <h1>Документы команды.</h1>
                    <p>Храните файлы, ищите по содержимому и обсуждайте документы с коллегами.</p>
                    <div className="story-index" aria-label="Возможности">
                        <span>
                            <b>01</b> Файлы и версии
                        </span>
                        <span>
                            <b>02</b> Поиск по тексту
                        </span>
                        <span>
                            <b>03</b> Совместная работа
                        </span>
                    </div>
                </div>
                <small>Modern Tech · Документы команды</small>
            </section>
            <section className="login-form-section">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        login.mutate({ email, password });
                    }}
                >
                    <div className="brand login-mobile-brand" aria-label="Modern Tech">
                        <span>
                            <Layers3 size={21} />
                        </span>
                        <div>
                            modern<span>tech</span>
                        </div>
                    </div>
                    <span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span>
                    <h2>С возвращением</h2>
                    <p className="muted">Войдите, чтобы продолжить работу с документами.</p>
                    <ErrorMessage error={login.error} />
                    <label>
                        Электронная почта
                        <input
                            autoComplete="username"
                            type="email"
                            placeholder="you@company.ru"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </label>
                    <label>
                        Пароль
                        <input
                            autoComplete="current-password"
                            type="password"
                            placeholder="Введите пароль"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </label>
                    <Button type="submit" disabled={login.isPending}>
                        {login.isPending ? 'Входим…' : 'Войти в пространство'}
                        <ArrowRight size={17} />
                    </Button>
                    <a className="login-help block" href="/forgot-password">
                        Забыли пароль?
                    </a>
                    <Link className="login-help block" to="/register">
                        Создать учётную запись
                    </Link>
                </form>
            </section>
        </div>
    );
};
