import { queryKeys } from '@/shared/api/query-keys';
import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Download, MoreHorizontal, Plus, RefreshCw, Unplug } from 'lucide-react';
import { api, ApiError } from '@/shared/api/client';
import type { CloudConnection, CloudTransfer, RemoteFile, Resource } from '@/shared/api/types';
import { DataTable, TableSkeleton } from '@/shared/ui/data-table';
import { FileIcon } from '@/shared/ui/file-icon';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/modal';
import { Popover } from '@/shared/ui/popover';
import { Select } from '@/shared/ui/select';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes } from '@/shared/lib/utils';
const statuses: Record<CloudTransfer['status'], string> = {
    queued: 'В очереди',
    running: 'Передача',
    completed: 'Готово',
    failed: 'Ошибка',
    cancelled: 'Отменено',
};
const authorizationMessages = new Map([
    ['connected', 'Яндекс Диск подключён.'],
    ['cancelled', 'Подключение отменено.'],
    ['expired', 'Время подключения истекло или аккаунт изменился. Попробуйте снова.'],
    ['failed', 'Не удалось подключить Яндекс Диск. Проверьте разрешения и попробуйте снова.'],
]);
export const IntegrationsPage = () => {
    const operationKeys = useRef(new Map<string, string>());
    const client = useQueryClient();
    const [params, setParams] = useSearchParams();
    const authorizationResult = params.get('yandex');
    const [selected, setSelected] = useState(() =>
        authorizationResult === 'connected' ? (params.get('connection') ?? '') : ''
    );
    const [path, setPath] = useState('/');
    const [provider, setProvider] = useState<'yandex' | 'mail'>(() =>
        params.get('provider') === 'mail' ? 'mail' : 'yandex'
    );
    const [isConnectOpen, setConnectOpen] = useState(() => params.get('connect') === '1');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const connections = useQuery({
        queryKey: [queryKeys.connections],
        queryFn: ({ signal }) => api<Resource<CloudConnection[]>>('/connections', { signal }),
    });
    const authorization = useQuery({
        queryKey: [queryKeys.yandexAuthorization],
        queryFn: ({ signal }) => api<Resource<{ available: boolean }>>('/connections/yandex/authorization', { signal }),
        enabled: provider === 'yandex',
    });
    const connectYandex = useMutation({
        mutationFn: (connectionId?: string) =>
            api<Resource<{ url: string }>>('/connections/yandex/authorization', {
                method: 'POST',
                body: JSON.stringify(connectionId ? { connection_id: connectionId } : {}),
            }),
        onSuccess: (result) => window.location.assign(result.data.url),
    });
    const files = useQuery({
        queryKey: [queryKeys.remoteFiles, selected, path],
        queryFn: async ({ signal }) => {
            try {
                return await api<Resource<RemoteFile[]>>(
                    `/connections/${selected}/files?${new URLSearchParams({ path })}`,
                    { signal }
                );
            } catch (error) {
                if (error instanceof ApiError && error.status === 422) {
                    void client.invalidateQueries({ queryKey: [queryKeys.connections] });
                }
                throw error;
            }
        },
        enabled: connections.data?.data.some((c) => c.id === selected && c.status === 'connected') ?? false,
        retry: false,
    });
    const transfers = useQuery({
        queryKey: [queryKeys.transfers],
        queryFn: ({ signal }) => api<Resource<CloudTransfer[]>>('/transfers', { signal }),
        refetchInterval: (q) =>
            q.state.data?.data.some((t) => ['queued', 'running'].includes(t.status)) ? 3000 : false,
    });
    const create = useMutation({
        mutationFn: () =>
            api('/connections', {
                method: 'POST',
                body: JSON.stringify({
                    provider: 'mail',
                    name,
                    email,
                    password,
                }),
            }),
        onSuccess: async () => {
            setPassword('');
            setName('');
            setConnectOpen(false);
            await client.invalidateQueries({ queryKey: [queryKeys.connections] });
        },
    });
    const disconnect = useMutation({
        mutationFn: (id: string) => api(`/connections/${id}`, { method: 'DELETE' }),
        onSuccess: async () => {
            setSelected('');
            client.removeQueries({ queryKey: [queryKeys.remoteFiles] });
            await client.invalidateQueries({ queryKey: [queryKeys.connections] });
            await client.invalidateQueries({ queryKey: [queryKeys.transfers] });
        },
    });
    const importFile = useMutation({
        mutationFn: (file: RemoteFile) => {
            const scope = selected + ':' + file.path;
            if (!operationKeys.current.has(scope)) {
                operationKeys.current.set(scope, crypto.randomUUID());
            }
            return api('/transfers', {
                headers: { 'Idempotency-Key': operationKeys.current.get(scope) ?? '' },
                method: 'POST',
                body: JSON.stringify({
                    connection_id: selected,
                    direction: 'import',
                    path: file.path,
                    filename: file.name,
                }),
            });
        },
        onSuccess: () => {
            operationKeys.current.clear();
            return client.invalidateQueries({ queryKey: [queryKeys.transfers] });
        },
    });
    const cancel = useMutation({
        mutationFn: (id: string) => api(`/transfers/${id}`, { method: 'DELETE' }),
        onSuccess: () => client.invalidateQueries({ queryKey: [queryKeys.transfers] }),
    });
    const providerConnections = connections.data?.data.filter((c) => c.provider === provider) ?? [];
    const providerTransfers =
        transfers.data?.data.filter((t) => providerConnections.some((c) => c.id === t.connection_id)) ?? [];
    const chooseProvider = (service: 'yandex' | 'mail') => {
        setProvider(service);
        setSelected('');
        setPath('/');
        setPassword('');
        create.reset();
        connectYandex.reset();
    };
    const closeConnect = () => {
        setPassword('');
        setConnectOpen(false);
        if (params.has('connect')) {
            const next = new URLSearchParams(params);
            next.delete('connect');
            setParams(next, { replace: true });
        }
    };
    return (
        <>
            <div className="page-heading">
                <h1>Облачные диски</h1>
                <Button
                    onClick={() => {
                        create.reset();
                        connectYandex.reset();
                        setConnectOpen(true);
                    }}
                >
                    <Plus size={16} /> Подключить диск
                </Button>
            </div>
            <div className="provider-tabs" role="group" aria-label="Облачный сервис">
                {(['yandex', 'mail'] as const).map((service) => (
                    <Button
                        key={service}
                        variant={provider === service ? 'default' : 'ghost'}
                        aria-pressed={provider === service}
                        onClick={() => chooseProvider(service)}
                    >
                        <span className={`provider-icon ${service}`}>{service === 'yandex' ? 'Я' : '@'}</span>
                        {service === 'yandex' ? 'Яндекс Диск' : 'Облако Mail'}
                    </Button>
                ))}
            </div>
            <ErrorMessage
                error={
                    authorization.error ||
                    connectYandex.error ||
                    connections.error ||
                    create.error ||
                    disconnect.error ||
                    importFile.error ||
                    cancel.error ||
                    transfers.error
                }
            />
            {authorizationResult && (
                <div
                    className="integration-notice"
                    role={
                        authorizationResult === 'connected' || authorizationResult === 'cancelled' ? 'status' : 'alert'
                    }
                >
                    <span>
                        {authorizationMessages.get(authorizationResult) ?? 'Повторите подключение Яндекс Диска.'}
                    </span>
                    <Button
                        variant="ghost"
                        size="small"
                        onClick={() => {
                            const next = new URLSearchParams(params);
                            next.delete('yandex');
                            next.delete('connection');
                            setParams(next, { replace: true });
                        }}
                    >
                        Закрыть
                    </Button>
                </div>
            )}
            <section className="content-panel form-panel">
                <h2>Мои подключения</h2>
                {connections.isPending && <p role="status">Загружаем подключения…</p>}
                {!connections.isPending &&
                    !connections.isError &&
                    !providerConnections.some((c) => c.status === 'connected') && (
                        <p className="muted">
                            {providerConnections.some((connection) => connection.status === 'authorization_required')
                                ? 'Войдите заново, чтобы продолжить работу с файлами.'
                                : 'Нет подключённых дисков.'}
                        </p>
                    )}
                {providerConnections
                    .filter((c) => c.status !== 'disconnected')
                    .map((c) => (
                        <div className="integration-row" key={c.id}>
                            <Button
                                variant={selected === c.id ? 'default' : 'secondary'}
                                disabled={c.status !== 'connected'}
                                onClick={() => {
                                    setSelected(c.id);
                                    setPath('/');
                                }}
                            >
                                {c.name} · {c.provider === 'yandex' ? 'Яндекс Диск' : 'Облако Mail'}
                            </Button>
                            {c.status === 'authorization_required' && (
                                <small className="muted">Нужно войти заново</small>
                            )}
                            <Popover align="end" label={`Действия: ${c.name}`} trigger={<MoreHorizontal size={16} />}>
                                {(close) => (
                                    <div className="menu-actions">
                                        {selected === c.id && c.status === 'connected' && (
                                            <Button
                                                variant="ghost"
                                                onClick={() => {
                                                    close();
                                                    void files.refetch();
                                                }}
                                            >
                                                <RefreshCw size={15} /> Обновить файлы
                                            </Button>
                                        )}
                                        {c.provider === 'yandex' && (
                                            <Button
                                                variant="ghost"
                                                disabled={
                                                    connectYandex.isPending || !authorization.data?.data.available
                                                }
                                                onClick={() => {
                                                    close();
                                                    connectYandex.mutate(c.id);
                                                }}
                                            >
                                                Переподключить
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            disabled={disconnect.isPending}
                                            onClick={() => {
                                                close();
                                                disconnect.mutate(c.id);
                                            }}
                                        >
                                            <Unplug size={16} /> Отключить
                                        </Button>
                                    </div>
                                )}
                            </Popover>
                        </div>
                    ))}
            </section>
            {selected && (
                <section className="content-panel form-panel">
                    <div className="integration-row">
                        <h2>Файлы облака</h2>
                        <Button
                            variant="ghost"
                            onClick={() => setPath(path.replace(/\/?[^/]+\/?$/, '') || '/')}
                            disabled={path === '/'}
                        >
                            <ArrowUp size={16} /> Выше
                        </Button>
                    </div>
                    <nav className="cloud-path" aria-label="Текущая папка">
                        <Button variant="ghost" size="small" onClick={() => setPath('/')}>
                            Диск
                        </Button>
                        {path
                            .split('/')
                            .filter(Boolean)
                            .map((part, index, parts) => (
                                <span key={index}>
                                    /{' '}
                                    <Button
                                        variant="ghost"
                                        size="small"
                                        onClick={() => setPath('/' + parts.slice(0, index + 1).join('/'))}
                                    >
                                        {part}
                                    </Button>
                                </span>
                            ))}
                    </nav>
                    <ErrorMessage error={files.error} />
                    {files.isPending && !files.isError && <TableSkeleton label="Загружаем файлы облака" />}
                    {files.data?.data.length === 0 && <p className="muted">Папка пуста.</p>}
                    {!!files.data?.data.length && (
                        <div className="table-scroll">
                            <DataTable className="cloud-file-table" isBusy={files.isFetching}>
                                <thead>
                                    <tr>
                                        <th>Имя</th>
                                        <th>Размер</th>
                                        <th aria-label="Действия" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {files.data.data.map((file) => (
                                        <tr key={file.path}>
                                            <td>
                                                <div className="cloud-file-name">
                                                    <FileIcon name={file.name} isFolder={file.type === 'dir'} />
                                                    {file.type === 'dir' ? (
                                                        <Button variant="ghost" onClick={() => setPath(file.path)}>
                                                            {file.name}
                                                        </Button>
                                                    ) : (
                                                        <span title={file.name}>{file.name}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="muted">
                                                {file.type === 'file' ? formatBytes(file.size) : '—'}
                                            </td>
                                            <td>
                                                {file.type === 'file' && (
                                                    <Button
                                                        variant="ghost"
                                                        disabled={importFile.isPending || file.size > 52_428_800}
                                                        title={
                                                            file.size > 52_428_800
                                                                ? 'Файл превышает лимит 50 МБ'
                                                                : undefined
                                                        }
                                                        onClick={() => importFile.mutate(file)}
                                                    >
                                                        <Download size={16} /> Импортировать
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </DataTable>
                        </div>
                    )}
                </section>
            )}
            {isConnectOpen && (
                <Modal
                    titleId="connect-disk-title"
                    onClose={closeConnect}
                    isBusy={create.isPending || connectYandex.isPending}
                >
                    <h2 id="connect-disk-title">Подключить диск</h2>
                    <ErrorMessage error={create.error || connectYandex.error || authorization.error} />
                    <div className="cloud-provider-field">
                        <Select
                            label="Сервис"
                            value={provider}
                            options={[
                                { value: 'yandex', label: 'Яндекс Диск' },
                                { value: 'mail', label: 'Облако Mail' },
                            ]}
                            onValueChange={(value) => chooseProvider(value === 'mail' ? 'mail' : 'yandex')}
                        />
                    </div>
                    {provider === 'yandex' ? (
                        <>
                            {authorization.data && !authorization.data.data.available && (
                                <p className="muted">Подключение пока недоступно. Обратитесь к администратору.</p>
                            )}
                            <footer>
                                <Button variant="secondary" onClick={closeConnect} disabled={connectYandex.isPending}>
                                    Отмена
                                </Button>
                                <Button
                                    disabled={connectYandex.isPending || !authorization.data?.data.available}
                                    onClick={() => connectYandex.mutate(undefined)}
                                >
                                    {connectYandex.isPending ? 'Переходим в Яндекс…' : 'Подключить Яндекс Диск'}
                                </Button>
                            </footer>
                        </>
                    ) : (
                        <form
                            className="dialog-form"
                            onSubmit={(e) => {
                                e.preventDefault();
                                create.mutate();
                            }}
                        >
                            <label>
                                Название
                                <input
                                    required
                                    maxLength={100}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Мой рабочий диск"
                                />
                            </label>
                            <label>
                                Почта Mail
                                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                            </label>
                            <label>
                                Пароль приложения
                                <input
                                    type="password"
                                    autoComplete="off"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </label>
                            <footer>
                                <Button
                                    variant="secondary"
                                    type="button"
                                    onClick={closeConnect}
                                    disabled={create.isPending}
                                >
                                    Отмена
                                </Button>
                                <Button disabled={create.isPending}>
                                    {create.isPending ? 'Подключаем…' : 'Подключить'}
                                </Button>
                            </footer>
                        </form>
                    )}
                </Modal>
            )}
            {providerTransfers.length > 0 && (
                <section className="content-panel form-panel">
                    <h2>Передачи</h2>

                    {providerTransfers.map((t) => (
                        <div className="integration-row" key={t.id}>
                            <span className="grow">
                                {t.filename}
                                <small className="block muted">{t.direction === 'import' ? 'Импорт' : 'Экспорт'}</small>
                            </span>
                            <span>{statuses[t.status] ?? t.status}</span>
                            {t.status === 'failed' && (
                                <small className="muted">
                                    Не удалось передать файл. Проверьте подключение и доступ.
                                </small>
                            )}
                            {t.status === 'queued' && (
                                <Button variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(t.id)}>
                                    Отменить
                                </Button>
                            )}
                        </div>
                    ))}
                </section>
            )}
        </>
    );
};
