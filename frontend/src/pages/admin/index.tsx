import './admin-controls.css';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { User, Role } from '@/shared/api/types';
import { Select } from '@/shared/ui/select';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';

export const UsersPage = () => {
    const client = useQueryClient();
    const listing = useCursorFilters({ sort: 'name', direction: 'asc' });
    const query = useQuery({
        queryKey: ['users', listing.search],
        queryFn: ({ signal }) => api<CursorResult<User>>(`/users?${listing.search}`, { signal }),
    });
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<Role>('employee');
    const create = useMutation({
        mutationFn: () => api('/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) }),
        onSuccess: async () => {
            setName('');
            setEmail('');
            setPassword('');
            await client.invalidateQueries({ queryKey: ['users'] });
        },
    });
    const toggle = useMutation({
        mutationFn: (u: User) =>
            api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) }),
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: ['session'] });
            await client.invalidateQueries({ queryKey: ['users'] });
        },
    });
    const changeRole = useMutation({
        mutationFn: ({ user, role }: { user: User; role: Role }) =>
            api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: ['session'] });
            await client.invalidateQueries({ queryKey: ['users'] });
        },
    });
    return (
        <>
            <div className="page-heading">
                <div>
                    <div className="breadcrumbs">Администрирование / Команда</div>
                    <h1>Пользователи</h1>
                </div>
            </div>
            <AdminFilters listing={listing} kind="users" />
            <ErrorMessage error={query.error || create.error || toggle.error || changeRole.error} />
            <section className="content-panel admin-table">
                <table className="documents-table">
                    <thead>
                        <tr>
                            <SortHeader listing={listing} field="name" label="Пользователь" />
                            <th>Роль</th>
                            <th>Статус</th>
                            <th aria-label="Действия" />
                        </tr>
                    </thead>
                    <tbody>
                        {query.data?.data.map((u) => (
                            <tr key={u.id}>
                                <td>
                                    <strong>{u.name}</strong>
                                    <small className="block muted">
                                        {u.email} · ID {u.id}
                                    </small>
                                </td>
                                <td>
                                    <Select
                                        label={`Роль пользователя ${u.name}`}
                                        value={u.role}
                                        disabled={changeRole.isPending || toggle.isPending}
                                        onValueChange={(value) => changeRole.mutate({ user: u, role: value as Role })}
                                        options={[
                                            { value: 'employee', label: 'Сотрудник' },
                                            { value: 'observer', label: 'Наблюдатель' },
                                            { value: 'admin', label: 'Администратор' },
                                        ]}
                                    />
                                </td>
                                <td>
                                    <span className={`user-status ${u.active ? 'active' : 'blocked'}`}>
                                        <span aria-hidden="true" />
                                        {u.active ? 'Активен' : 'Заблокирован'}
                                    </span>
                                </td>
                                <td>
                                    <Button
                                        variant="ghost"
                                        size="small"
                                        className={u.active ? 'user-block-action' : 'user-unblock-action'}
                                        disabled={toggle.isPending}
                                        onClick={() => toggle.mutate(u)}
                                    >
                                        {u.active ? 'Заблокировать' : 'Разблокировать'}
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
            <CursorNavigation meta={query.data?.meta} busy={query.isFetching} onChange={listing.navigate} />
            <section className="content-panel form-panel">
                <h2>Добавить участника</h2>
                <form
                    className="user-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        create.mutate();
                    }}
                >
                    <label>
                        Имя
                        <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                    </label>
                    <label>
                        Электронная почта
                        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </label>
                    <label>
                        Пароль
                        <input
                            required
                            type="password"
                            minLength={12}
                            maxLength={128}
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </label>
                    <label>
                        Роль
                        <Select
                            label="Роль"
                            value={role}
                            onValueChange={(value) => setRole(value as Role)}
                            options={[
                                { value: 'employee', label: 'Сотрудник' },
                                { value: 'observer', label: 'Наблюдатель' },
                                { value: 'admin', label: 'Администратор' },
                            ]}
                        />
                    </label>
                    <Button disabled={create.isPending}>
                        {create.isPending ? 'Создаём…' : 'Создать пользователя'}
                    </Button>
                </form>
            </section>
        </>
    );
};
interface AuditEvent {
    id: string;
    action: string;
    actor_id: number | null;
    actor_name: string | null;
    resource_name: string | null;
    resource_id: string | null;
    created_at: string;
}
export const AuditPage = () => {
    const listing = useCursorFilters({ sort: 'created_at', direction: 'desc' });
    const query = useQuery({
        queryKey: ['audit', listing.search],
        queryFn: ({ signal }) => api<CursorResult<AuditEvent>>(`/admin/audit?${listing.search}`, { signal }),
    });
    return (
        <>
            <div className="page-heading">
                <div>
                    <div className="breadcrumbs">Администрирование / История</div>
                    <h1>Журнал действий</h1>
                    <p className="muted">Изменения документов, прав и участников.</p>
                </div>
            </div>
            <AdminFilters listing={listing} kind="audit" />
            <ErrorMessage error={query.error} />
            <section className="content-panel admin-table">
                <table className="documents-table">
                    <thead>
                        <tr>
                            <SortHeader listing={listing} field="action" label="Событие" />
                            <th>Пользователь</th>
                            <th>Ресурс</th>
                            <SortHeader listing={listing} field="created_at" label="Время" />
                        </tr>
                    </thead>
                    <tbody>
                        {query.data?.data.map((e) => (
                            <tr key={e.id}>
                                <td>
                                    {(
                                        {
                                            'version.uploaded': 'Загружена версия',
                                            'comment.created': 'Добавлен комментарий',
                                            'comment.updated': 'Изменён комментарий',
                                            'comment.deleted': 'Удалён комментарий',
                                            'document.updated': 'Изменён документ',
                                            'document.deleted': 'Документ в корзине',
                                            'document.restored': 'Документ восстановлен',
                                            'document.grants.updated': 'Изменены права',
                                            'user.created': 'Добавлен пользователь',
                                            'user.updated': 'Изменён пользователь',
                                            'transfer.created': 'Создана передача',
                                            'transfer.completed': 'Передача завершена',
                                            'document.recovered': 'Документ восстановлен',
                                            'document.moved': 'Документ перемещён',
                                            'document.tags.updated': 'Изменены теги',
                                        } as Record<string, string>
                                    )[e.action] ?? 'Другое событие'}
                                </td>
                                <td>{e.actor_name ?? 'Система'}</td>
                                <td>
                                    <code>{e.resource_name ?? e.resource_id?.slice(0, 12) ?? '—'}</code>
                                </td>
                                <td>{new Date(e.created_at).toLocaleString('ru-RU')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!query.data?.data.length && !query.isPending && !query.isError && (
                    <div className="empty-state">Пока нет событий</div>
                )}
            </section>
            <CursorNavigation meta={query.data?.meta} busy={query.isFetching} onChange={listing.navigate} />
        </>
    );
};

interface CursorMeta {
    next_cursor: string | null;
    prev_cursor: string | null;
    per_page: number;
}
interface CursorResult<T> {
    data: T[];
    meta: CursorMeta;
}
const useCursorFilters = (defaults: Record<string, string>) => {
    const [filters, setFilters] = useState(defaults);
    const [cursor, setCursor] = useState('');
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''));
    if (cursor) {
        params.set('cursor', cursor);
    }
    return {
        filters,
        search: params.toString(),
        change: (key: string, value: string) => {
            setCursor('');
            setFilters((old) => ({ ...old, [key]: value }));
        },
        sort: (field: string) => {
            setCursor('');
            setFilters((old) => ({
                ...old,
                sort: field,
                direction: old.sort === field && old.direction === 'desc' ? 'asc' : 'desc',
            }));
        },
        reset: () => {
            setCursor('');
            setFilters(defaults);
        },
        navigate: (value: string) => setCursor(value),
    };
};
const SortHeader = ({
    listing,
    field,
    label,
}: {
    listing: ReturnType<typeof useCursorFilters>;
    field: string;
    label: string;
}) => {
    const active = listing.filters.sort === field;
    const asc = listing.filters.direction === 'asc';
    return (
        <th aria-sort={active ? (asc ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="table-sort" onClick={() => listing.sort(field)}>
                {label} {active && <span aria-hidden="true">{asc ? '↑' : '↓'}</span>}
            </button>
        </th>
    );
};
const CursorNavigation = ({
    meta,
    busy,
    onChange,
}: {
    meta: CursorMeta | undefined;
    busy: boolean;
    onChange: (cursor: string) => void;
}) => (
    <nav className="admin-cursor-navigation" aria-label="Навигация по списку">
        <span className="muted">{busy ? 'Загружаем…' : `До ${meta?.per_page ?? 20} записей за раз`}</span>
        <div>
            <Button
                variant="secondary"
                disabled={busy || !meta?.prev_cursor}
                onClick={() => meta?.prev_cursor && onChange(meta.prev_cursor)}
            >
                Назад
            </Button>
            <Button
                variant="secondary"
                disabled={busy || !meta?.next_cursor}
                onClick={() => meta?.next_cursor && onChange(meta.next_cursor)}
            >
                Дальше
            </Button>
        </div>
    </nav>
);
const AdminFilters = ({ listing, kind }: { listing: ReturnType<typeof useCursorFilters>; kind: 'users' | 'audit' }) => {
    const users = kind === 'users';
    const field = (key: string, label: string, type = 'text') => (
        <label>
            {label}
            <input
                type={type}
                value={listing.filters[key] ?? ''}
                maxLength={key === 'q' ? 200 : 100}
                onChange={(event) => listing.change(key, event.target.value)}
            />
        </label>
    );
    const select = (key: string, label: string, options: { value: string; label: string }[]) => (
        <label>
            {label}
            <Select
                label={label}
                value={listing.filters[key] ?? ''}
                onValueChange={(value) => listing.change(key, value)}
                options={options}
            />
        </label>
    );
    return (
        <section className="admin-list-filters" aria-label={users ? 'Фильтры пользователей' : 'Фильтры журнала'}>
            {field('q', users ? 'Имя или почта' : 'Пользователь или ресурс')}
            {users ? (
                <>
                    {select('role', 'Роль', [
                        { value: '', label: 'Все роли' },
                        { value: 'admin', label: 'Администратор' },
                        { value: 'employee', label: 'Сотрудник' },
                        { value: 'observer', label: 'Наблюдатель' },
                    ])}
                    {select('active', 'Статус', [
                        { value: '', label: 'Все статусы' },
                        { value: '1', label: 'Активен' },
                        { value: '0', label: 'Заблокирован' },
                    ])}
                </>
            ) : (
                <>
                    {field('action', 'Код события')}
                    {field('actor_id', 'ID пользователя', 'number')}
                    {field('date_from', 'С даты', 'date')}
                    {field('date_to', 'По дату', 'date')}
                </>
            )}
            <Button variant="ghost" onClick={listing.reset}>
                Сбросить
            </Button>
        </section>
    );
};
