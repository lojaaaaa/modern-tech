import type { CloudTransfer } from '@/shared/api/types';
import { ActionMenu } from '@/shared/ui/action-menu';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Plus, RefreshCw, Unplug } from 'lucide-react';
import { useIntegrationsModel } from '../model/useIntegrationsModel';
import { ConnectDiskDialog } from './ConnectDiskDialog';
import { RemoteFiles } from './RemoteFiles';

const providerNames: Record<string, string> = { google: 'Google Drive', mail: 'Облако Mail' };

const statuses: Record<CloudTransfer['status'], string> = {
    queued: 'В очереди',
    running: 'Передача',
    completed: 'Готово',
    failed: 'Ошибка',
    cancelled: 'Отменено',
};

const authorizationMessages = new Map([
    ['connected', 'Google Drive подключён.'],
    ['cancelled', 'Подключение отменено.'],
    ['expired', 'Время подключения истекло или аккаунт изменился. Попробуйте снова.'],
    ['failed', 'Не удалось подключить облачный диск. Проверьте разрешения и попробуйте снова.'],
]);

export const IntegrationsPage = () => {
    const {
        params,
        setParams,
        authorizationResult,
        selected,
        setSelected,
        path,
        setPath,
        provider,
        isConnectOpen,
        setConnectOpen,
        name,
        setName,
        email,
        setEmail,
        password,
        setPassword,
        connections,
        authorization,
        connectGoogle,
        files,
        transfers,
        create,
        disconnect,
        importFile,
        cancel,
        providerConnections,
        providerTransfers,
        chooseProvider,
        closeConnect,
    } = useIntegrationsModel();

    return (
        <>
            <div className="page-heading">
                <h1>Облачные диски</h1>
                <Button
                    onClick={() => {
                        create.reset();
                        connectGoogle.reset();
                        setConnectOpen(true);
                    }}
                >
                    <Plus size={16} /> Подключить диск
                </Button>
            </div>
            <div className="provider-tabs" role="group" aria-label="Облачный сервис">
                {(['google', 'mail'] as const).map((service) => (
                    <Button
                        key={service}
                        variant={provider === service ? 'default' : 'ghost'}
                        aria-pressed={provider === service}
                        onClick={() => chooseProvider(service)}
                    >
                        <span className={`provider-icon ${service}`}>{service === 'google' ? 'G' : '@'}</span>
                        {providerNames[service]}
                    </Button>
                ))}
            </div>
            <ErrorMessage
                error={
                    authorization.error ||
                    connectGoogle.error ||
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
                        {params.has('google') && authorizationResult === 'connected'
                            ? 'Google Drive подключён.'
                            : (authorizationMessages.get(authorizationResult) ?? 'Повторите подключение диска.')}
                    </span>
                    <Button
                        variant="ghost"
                        size="small"
                        onClick={() => {
                            const next = new URLSearchParams(params);
                            next.delete('google');
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
                                {c.name} · {providerNames[c.provider]}
                            </Button>
                            {c.status === 'authorization_required' && (
                                <small className="muted">Нужно войти заново</small>
                            )}
                            <ActionMenu label={`Действия: ${c.name}`}>
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
                                        {c.provider !== 'mail' && (
                                            <Button
                                                variant="ghost"
                                                disabled={
                                                    connectGoogle.isPending || !authorization.data?.data.available
                                                }
                                                onClick={() => {
                                                    close();
                                                    connectGoogle.mutate(c.id);
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
                            </ActionMenu>
                        </div>
                    ))}
            </section>
            {selected && (
                <RemoteFiles path={path} setPath={setPath} name={name} files={files} importFile={importFile} />
            )}
            {isConnectOpen && (
                <ConnectDiskDialog
                    provider={provider}
                    name={name}
                    setName={setName}
                    email={email}
                    setEmail={setEmail}
                    password={password}
                    setPassword={setPassword}
                    authorization={authorization}
                    connectGoogle={connectGoogle}
                    create={create}
                    chooseProvider={chooseProvider}
                    closeConnect={closeConnect}
                />
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
