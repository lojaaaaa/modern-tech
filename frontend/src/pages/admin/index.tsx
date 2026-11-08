import { Pagination } from '@/shared/ui/pagination';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { Resource, User, Role } from '@/shared/api/types';
import { Select } from '@/shared/ui/select';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';

export const UsersPage = () => {
    const client = useQueryClient();
    const query = useQuery({
        queryKey: ['users'],
        queryFn: ({ signal }) => api<Resource<User[]>>('/users', { signal }),
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
            <ErrorMessage error={query.error || create.error || toggle.error || changeRole.error} />
            <section className="content-panel table-scroll">
                <table className="documents-table">
                    <thead>
                        <tr>
                            <th>Пользователь</th>
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
                                <td>{u.active ? 'Активен' : 'Заблокирован'}</td>
                                <td>
                                    <Button
                                        variant="ghost"
                                        size="small"
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
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ['audit', page],
        queryFn: ({ signal }) =>
            api<{ data: AuditEvent[]; last_page: number }>(`/admin/audit?page=${page}`, { signal }),
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
            <ErrorMessage error={query.error} />
            <section className="content-panel table-scroll">
                <table className="documents-table">
                    <thead>
                        <tr>
                            <th>Событие</th>
                            <th>Пользователь</th>
                            <th>Ресурс</th>
                            <th>Время</th>
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
            <Pagination page={page} pages={query.data?.last_page ?? 1} onChange={setPage} busy={query.isFetching} />
        </>
    );
};
