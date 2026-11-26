import { FilterOptions, FilterPopover } from '@/shared/ui/filter-popover';
import { ActionMenu } from '@/shared/ui/action-menu';
import { queryKeys } from '@/shared/api/query-keys';
import './admin-controls.css';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { User, Role } from '@/shared/api/types';
import type { operations } from '@/shared/api/schema';
import { Select } from '@/shared/ui/select';
import { CursorPagination } from '@/shared/ui/pagination';
import { DataTable, TableSkeleton, TableToolbar, TableViewport } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { AlertDialog } from '@/shared/ui/alert-dialog';
import { Modal } from '@/shared/ui/modal';
import { SearchInput } from '@/shared/ui/search-input';
import { DateRangePicker } from '@/shared/ui/date-range-picker';

const roleLabels: Record<Role, string> = { admin: 'Администратор', employee: 'Сотрудник', observer: 'Наблюдатель' };

export const UsersPage = () => {
    const client = useQueryClient();
    const listing = useCursorFilters({ sort: 'name', direction: 'asc' });

    const query = useQuery({
        queryKey: [queryKeys.users, listing.search],
        queryFn: ({ signal }) =>
            api<operations['user.index']['responses'][200]['content']['application/json']>(`/users?${listing.search}`, {
                signal,
            }),
    });

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<Role>('employee');
    const [isCreateOpen, setCreateOpen] = useState(false);
    const [blockUser, setBlockUser] = useState<User | null>(null);

    const create = useMutation({
        mutationFn: () => api('/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) }),
        onSuccess: async () => {
            setName('');
            setEmail('');
            setPassword('');
            setCreateOpen(false);
            await client.invalidateQueries({ queryKey: [queryKeys.users] });
        },
    });

    const toggle = useMutation({
        mutationFn: (u: User) =>
            api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !u.active }) }),
        onSuccess: async () => {
            setBlockUser(null);
            await client.invalidateQueries({ queryKey: [queryKeys.session] });
            await client.invalidateQueries({ queryKey: [queryKeys.users] });
        },
    });

    const changeRole = useMutation({
        mutationFn: ({ user, role }: { user: User; role: Role }) =>
            api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: [queryKeys.session] });
            await client.invalidateQueries({ queryKey: [queryKeys.users] });
        },
    });

    return (
        <>
            <div className="page-heading">
                <h1>Команда</h1>
                <Button
                    onClick={() => {
                        create.reset();
                        setCreateOpen(true);
                    }}
                >
                    <Plus size={16} /> Добавить участника
                </Button>
            </div>
            <ErrorMessage error={query.error || changeRole.error || (!blockUser && toggle.error)} />
            <section className="content-panel admin-panel">
                <AdminFilters listing={listing} kind="users" />
                <TableViewport className="admin-table">
                    <DataTable isBusy={query.isFetching}>
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
                                        <div className="owner-cell">
                                            <span className="avatar">{u.name.slice(0, 1)}</span>
                                            <div>
                                                <strong>{u.name}</strong>
                                                <small className="block muted">{u.email}</small>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{roleLabels[u.role]}</td>
                                    <td>
                                        <span className={`user-status ${u.active ? 'active' : 'blocked'}`}>
                                            <span aria-hidden="true" />
                                            {u.active ? 'Активен' : 'Заблокирован'}
                                        </span>
                                    </td>
                                    <td>
                                        <ActionMenu label={`Действия: ${u.name}`}>
                                            {(close) => (
                                                <div className="menu-actions">
                                                    <Select
                                                        label={`Роль пользователя ${u.name}`}
                                                        value={u.role}
                                                        isDisabled={changeRole.isPending || toggle.isPending}
                                                        onValueChange={(value) => {
                                                            close();
                                                            if (value !== u.role) {
                                                                changeRole.mutate({ user: u, role: value as Role });
                                                            }
                                                        }}
                                                        options={Object.entries(roleLabels).map(([value, label]) => ({
                                                            value,
                                                            label,
                                                        }))}
                                                    />
                                                    <Button
                                                        variant={u.active ? 'destructive' : 'ghost'}
                                                        disabled={toggle.isPending}
                                                        onClick={() => {
                                                            close();
                                                            toggle.reset();
                                                            if (u.active) {
                                                                setBlockUser(u);
                                                            } else {
                                                                toggle.mutate(u);
                                                            }
                                                        }}
                                                    >
                                                        {u.active ? 'Заблокировать' : 'Разблокировать'}
                                                    </Button>
                                                </div>
                                            )}
                                        </ActionMenu>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </DataTable>
                    {query.isPending && <TableSkeleton label="Загружаем участников" />}
                    {!query.isPending && !query.isError && !query.data?.data.length && (
                        <p className="empty-state">Участники не найдены.</p>
                    )}
                </TableViewport>
                <CursorPagination meta={query.data} isBusy={query.isFetching} onChange={listing.navigate} />
            </section>
            {blockUser && (
                <AlertDialog
                    title="Заблокировать пользователя?"
                    description={`«${blockUser.name}» потеряет доступ к приложению до разблокировки.`}
                    confirmLabel="Заблокировать"
                    isBusy={toggle.isPending}
                    error={toggle.error}
                    onClose={() => {
                        setBlockUser(null);
                        toggle.reset();
                    }}
                    onConfirm={() => toggle.mutate(blockUser)}
                />
            )}
            {isCreateOpen && (
                <Modal
                    titleId="create-user-title"
                    onClose={() => {
                        setCreateOpen(false);
                        setPassword('');
                    }}
                    isBusy={create.isPending}
                >
                    <h2 id="create-user-title">Добавить участника</h2>
                    <ErrorMessage error={create.error} />
                    <form
                        className="dialog-form"
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
                        <footer>
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={create.isPending}
                                onClick={() => {
                                    setCreateOpen(false);
                                    setPassword('');
                                }}
                            >
                                Отмена
                            </Button>
                            <Button disabled={create.isPending}>
                                {create.isPending ? 'Создаём…' : 'Создать пользователя'}
                            </Button>
                        </footer>
                    </form>
                </Modal>
            )}
        </>
    );
};
interface AuditEvent {
    id: string;
    action: string;
    display_action?: string;
    actor_id: number | null;
    actor_name: string | null;
    resource_name: string | null;
    resource_id: string | null;
    created_at: string;
}

const auditLabels: Record<string, string> = {
    'version.uploaded': 'Загружена версия',
    'comment.created': 'Добавлен комментарий',
    'comment.updated': 'Изменён комментарий',
    'comment.deleted': 'Удалён комментарий',
    'comment.resolved': 'Обсуждение закрыто',
    'comment.reopened': 'Обсуждение открыто повторно',
    'document.updated': 'Изменён документ',
    'document.deleted': 'Документ перемещён в корзину',
    'document.restored': 'Документ восстановлен',
    'document.purged': 'Документ удалён навсегда',
    'document.batch.trash': 'Документ перемещён в корзину',
    'document.batch.restore': 'Документ восстановлен',
    'document.batch.favorite': 'Документ добавлен в избранное',
    'document.grants.updated': 'Изменены разрешения',
    'user.created': 'Добавлен пользователь',
    'user.updated': 'Изменены данные пользователя',
    'user.blocked': 'Пользователь заблокирован',
    'user.unblocked': 'Пользователь разблокирован',
    'user.role_changed': 'Изменена роль пользователя',
    'user.registered': 'Пользователь зарегистрирован',
    'user.password_reset': 'Пароль пользователя сброшен',
    'transfer.created': 'Создана передача',
    'transfer.completed': 'Передача завершена',
    'document.recovered': 'Документ восстановлен',
    'document.moved': 'Документ перемещён',
    'document.tags.updated': 'Изменены теги',
};

export const AuditPage = () => {
    const listing = useCursorFilters({ sort: 'created_at', direction: 'desc' });

    const query = useQuery({
        queryKey: [queryKeys.audit, listing.search],
        queryFn: ({ signal }) => api<CursorResult<AuditEvent>>(`/admin/audit?${listing.search}`, { signal }),
    });

    return (
        <>
            <div className="page-heading">
                <h1>Журнал действий</h1>
            </div>
            <ErrorMessage error={query.error} />
            <section className="content-panel admin-panel">
                <AdminFilters listing={listing} kind="audit" />
                <TableViewport className="admin-table">
                    <DataTable isBusy={query.isFetching}>
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
                                        <span title={e.action}>
                                            {auditLabels[e.display_action ?? e.action] ?? e.action}
                                        </span>
                                    </td>
                                    <td>{e.actor_name ?? 'Система'}</td>
                                    <td>
                                        <span title={e.resource_id ?? undefined}>
                                            {e.resource_name ?? e.resource_id?.slice(0, 12) ?? '—'}
                                        </span>
                                    </td>
                                    <td>{new Date(e.created_at).toLocaleString('ru-RU')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </DataTable>
                    {!query.data?.data.length && !query.isPending && !query.isError && (
                        <div className="empty-state">События не найдены.</div>
                    )}
                    {query.isPending && <TableSkeleton label="Загружаем журнал" />}
                </TableViewport>
                <CursorPagination meta={query.data} isBusy={query.isFetching} onChange={listing.navigate} />
            </section>
        </>
    );
};

interface CursorMeta {
    next_cursor: string | null;
    prev_cursor: string | null;
    per_page: number;
}
interface CursorResult<T> extends CursorMeta {
    data: T[];
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
    const isActive = listing.filters.sort === field;
    const isAscending = listing.filters.direction === 'asc';

    return (
        <th aria-sort={isActive ? (isAscending ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="table-sort" onClick={() => listing.sort(field)}>
                {label} {isActive && <span aria-hidden="true">{isAscending ? '↑' : '↓'}</span>}
            </button>
        </th>
    );
};

const AdminFilters = ({ listing, kind }: { listing: ReturnType<typeof useCursorFilters>; kind: 'users' | 'audit' }) => {
    const isUsersList = kind === 'users';

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
        <FilterOptions
            label={label}
            value={listing.filters[key] ?? ''}
            onValueChange={(value) => listing.change(key, value)}
            options={options}
        />
    );

    const count = Object.entries(listing.filters).filter(
        ([key, value]) => !['q', 'sort', 'direction'].includes(key) && value
    ).length;

    return (
        <TableToolbar label={isUsersList ? 'Фильтры пользователей' : 'Фильтры журнала'}>
            <SearchInput
                initialValue={listing.filters.q ?? ''}
                maxLength={200}
                label={isUsersList ? 'Имя или почта' : 'Пользователь или ресурс'}
                placeholder={isUsersList ? 'Имя или почта' : 'Пользователь или ресурс'}
                onSearch={(value) => listing.change('q', value)}
            />
            <FilterPopover count={count} onReset={listing.reset}>
                {isUsersList ? (
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
                        {select('action', 'Событие', [
                            { value: '', label: 'Все события' },
                            ...Object.entries(auditLabels)
                                .filter(
                                    ([value]) =>
                                        !['user.blocked', 'user.unblocked', 'user.role_changed'].includes(value)
                                )
                                .map(([value, label]) => ({ value, label })),
                        ])}
                        {field('action', 'Код события')}
                        {field('actor_id', 'ID пользователя', 'number')}
                        <DateRangePicker
                            label="Период"
                            from={listing.filters.date_from ?? ''}
                            to={listing.filters.date_to ?? ''}
                            onFromChange={(value) => listing.change('date_from', value)}
                            onToChange={(value) => listing.change('date_to', value)}
                        />
                    </>
                )}
            </FilterPopover>
        </TableToolbar>
    );
};
