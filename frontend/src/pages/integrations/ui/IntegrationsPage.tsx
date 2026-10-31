import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Folder, FileText, ArrowUp, Download, Unplug } from 'lucide-react';
import { api } from '@/shared/api/client';
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
    const [selected, setSelected] = useState('');
    const [path, setPath] = useState('/');
    const [provider, setProvider] = useState<'yandex' | 'mail'>('yandex');
    const [name, setName] = useState('');
    const [token, setToken] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const connections = useQuery({
        queryKey: ['connections'],
        queryFn: ({ signal }) => api<Resource<Connection[]>>('/connections', { signal }),
    });
    const files = useQuery({
        queryKey: ['remote-files', selected, path],
        queryFn: ({ signal }) =>
            api<Resource<RemoteFile[]>>(`/connections/${selected}/files?${new URLSearchParams({ path })}`, { signal }),
        enabled: !!selected,
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
                    provider,
                    name,
                    ...(provider === 'yandex' ? { token } : { email, password }),
                }),
            }),
        onSuccess: async () => {
            setToken('');
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
                    <div className="breadcrumbs">Рабочее пространство / Подключения</div>
                    <h1>Облачные диски</h1>
                </div>
                <Cloud size={30} />
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
                            setToken('');
                            setPassword('');
                            create.reset();
                        }}
                    >
                        <span className={`provider-icon ${service}`}>{service === 'yandex' ? 'Я' : '@'}</span>
                        {service === 'yandex' ? 'Яндекс Диск' : 'Облако Mail'}
                    </Button>
                ))}
            </div>
            <ErrorMessage
                error={
                    connections.error ||
                    create.error ||
                    disconnect.error ||
                    importFile.error ||
                    cancel.error ||
                    transfers.error
                }
            />
            <section className="content-panel form-panel">
                <h2>Мои подключения</h2>
                {!providerConnections.some((c) => c.status === 'connected') && <p className="muted">Нет подключений</p>}
                {providerConnections
                    .filter((c) => c.status === 'connected')
                    .map((c) => (
                        <div className="integration-row" key={c.id}>
                            <Button
                                variant={selected === c.id ? 'default' : 'secondary'}
                                onClick={() => {
                                    setSelected(c.id);
                                    setPath('/');
                                }}
                            >
                                {c.name} · {c.provider === 'yandex' ? 'Яндекс Диск' : 'Облако Mail'}
                            </Button>
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
                                    <small className="muted">{formatBytes(file.size)}</small>
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
                <h2>Подключить диск</h2>
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
                    {provider === 'yandex' ? (
                        <label>
                            OAuth-токен пользователя
                            <input
                                type="password"
                                autoComplete="off"
                                required
                                placeholder="Токен доступа, не Client ID / Client secret"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                            />
                        </label>
                    ) : (
                        <>
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
                        </>
                    )}
                    <Button disabled={create.isPending}>Подключить</Button>
                </form>
            </section>
            {providerTransfers.length > 0 && (
                <section className="content-panel form-panel">
                    <h2>Передачи</h2>

                    {providerTransfers.length === 0 && <p>Передач пока нет.</p>}
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
