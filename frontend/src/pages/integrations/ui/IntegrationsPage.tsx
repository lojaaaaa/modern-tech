import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, FileText, ArrowUp, Download, Unplug } from 'lucide-react';
import { api, ApiError } from '@/shared/api/client';
import type { Resource } from '@/shared/api/types';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes } from '@/shared/lib/utils';
interface Connection {
    id: string;
    name: string;
    provider: 'yandex' | 'mail';
    status: string;
}
interface RemoteFile {
    name: string;
    path: string;
    type: string;
    size: number;
}
interface Transfer {
    id: string;
    filename: string;
    connection_id: string;
    direction: string;
    status: string;
    error_code: string | null;
}
const statuses: Record<string, string> = {
    queued: 'В очереди',
    running: 'Передача',
    completed: 'Готово',
    failed: 'Ошибка',
    cancelled: 'Отменено',
};
export const IntegrationsPage = () => {
    const operationKeys = useRef(new Map<string, string>());
    const client = useQueryClient();
    const [params, setParams] = useSearchParams();
    const [selected, setSelected] = useState(() =>
        params.get('yandex') === 'connected' ? (params.get('connection') ?? '') : ''
    );
    const [path, setPath] = useState('/');
    const [provider, setProvider] = useState<'yandex' | 'mail'>('yandex');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const connections = useQuery({
        queryKey: ['connections'],
        queryFn: ({ signal }) => api<Resource<Connection[]>>('/connections', { signal }),
    });
    const authorization = useQuery({
        queryKey: ['yandex-authorization'],
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
        queryKey: ['remote-files', selected, path],
        queryFn: async ({ signal }) => {
            try {
                return await api<Resource<RemoteFile[]>>(
                    `/connections/${selected}/files?${new URLSearchParams({ path })}`,
                    { signal }
                );
            } catch (error) {
                if (error instanceof ApiError && error.status === 422) {
                    void client.invalidateQueries({ queryKey: ['connections'] });
                }
                throw error;
            }
        },
        enabled: connections.data?.data.some((c) => c.id === selected && c.status === 'connected') ?? false,
        retry: false,
    });
    const transfers = useQuery({
        queryKey: ['transfers'],
        queryFn: ({ signal }) => api<Resource<Transfer[]>>('/transfers', { signal }),
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
            await client.invalidateQueries({ queryKey: ['connections'] });
        },
    });
    const disconnect = useMutation({
        mutationFn: (id: string) => api(`/connections/${id}`, { method: 'DELETE' }),
        onSuccess: async () => {
            setSelected('');
            client.removeQueries({ queryKey: ['remote-files'] });
            await client.invalidateQueries({ queryKey: ['connections'] });
            await client.invalidateQueries({ queryKey: ['transfers'] });
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
            return client.invalidateQueries({ queryKey: ['transfers'] });
        },
    });
    const cancel = useMutation({
        mutationFn: (id: string) => api(`/transfers/${id}`, { method: 'DELETE' }),
        onSuccess: () => client.invalidateQueries({ queryKey: ['transfers'] }),
    });
    const providerConnections = connections.data?.data.filter((c) => c.provider === provider) ?? [];
    const providerTransfers =
        transfers.data?.data.filter((t) => providerConnections.some((c) => c.id === t.connection_id)) ?? [];
    return (
        <>
            <div className="page-heading">
                <div>
                    <div className="breadcrumbs">Документы / Облачные диски</div>
                    <h1>Облачные диски</h1>
                </div>
            </div>
            <div className="provider-tabs" role="group" aria-label="Облачный сервис">
                {(['yandex', 'mail'] as const).map((service) => (
                    <Button
                        key={service}
                        variant={provider === service ? 'default' : 'ghost'}
                        aria-pressed={provider === service}
                        onClick={() => {
                            setProvider(service);
                            setSelected('');
                            setPath('/');
                            setPassword('');
                            create.reset();
                            connectYandex.reset();
                        }}
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
            {params.get('yandex') && (
                <div
                    className="integration-notice"
                    role={
                        params.get('yandex') === 'connected' || params.get('yandex') === 'cancelled'
                            ? 'status'
                            : 'alert'
                    }
                >
                    <span>
                        {(
                            {
                                connected: 'Яндекс Диск подключён.',
                                cancelled: 'Подключение отменено.',
                                expired: 'Время подключения истекло или аккаунт изменился. Попробуйте снова.',
                                failed: 'Не удалось подключить Яндекс Диск. Проверьте разрешения и попробуйте снова.',
                            } as Record<string, string>
                        )[params.get('yandex') ?? ''] ?? 'Повторите подключение Яндекс Диска.'}
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
                        <p className="muted">Подключите диск ниже, чтобы выбрать файлы для импорта.</p>
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
                            {c.provider === 'yandex' && (
                                <Button
                                    variant="ghost"
                                    disabled={connectYandex.isPending || !authorization.data?.data.available}
                                    onClick={() => connectYandex.mutate(c.id)}
                                >
                                    Переподключить
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                disabled={disconnect.isPending}
                                onClick={() => disconnect.mutate(c.id)}
                            >
                                <Unplug size={16} /> Отключить
                            </Button>
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
                    <p className="muted">{path}</p>
                    <ErrorMessage error={files.error} />
                    {files.isPending && <p role="status">Загружаем список…</p>}
                    {files.data?.data.length === 0 && <p className="muted">Папка пуста.</p>}
                    {files.data?.data.map((file) => (
                        <div className="integration-row" key={file.path}>
                            {file.type === 'dir' ? <Folder size={18} /> : <FileText size={18} />}
                            <span className="grow">{file.name}</span>
                            {file.type === 'dir' ? (
                                <Button variant="ghost" onClick={() => setPath(file.path)}>
                                    Открыть
                                </Button>
                            ) : (
                                <>
                                    <small className="muted">
                                        {formatBytes(file.size)}
                                        {file.size > 52_428_800 ? ' · больше лимита 50 МБ' : ''}
                                    </small>
                                    <Button
                                        variant="secondary"
                                        disabled={importFile.isPending || file.size > 52_428_800}
                                        onClick={() => importFile.mutate(file)}
                                    >
                                        <Download size={16} /> Импортировать
                                    </Button>
                                </>
                            )}
                        </div>
                    ))}
                </section>
            )}
            <section className="content-panel form-panel">
                <h2>{provider === 'yandex' ? 'Подключить Яндекс Диск' : 'Подключить Облако Mail'}</h2>
                {provider === 'yandex' ? (
                    <div className="integration-connect">
                        <p className="muted">Разрешите доступ к файлам на странице Яндекса.</p>
                        <Button
                            disabled={connectYandex.isPending || !authorization.data?.data.available}
                            onClick={() => connectYandex.mutate(undefined)}
                        >
                            {connectYandex.isPending ? 'Переходим в Яндекс…' : 'Подключить Яндекс Диск'}
                        </Button>
                        {authorization.data && !authorization.data.data.available && (
                            <p className="muted">Подключение пока недоступно. Обратитесь к администратору.</p>
                        )}
                    </div>
                ) : (
                    <form
                        className="user-form"
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
                        <Button disabled={create.isPending}>{create.isPending ? 'Подключаем…' : 'Подключить'}</Button>
                    </form>
                )}
            </section>
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
