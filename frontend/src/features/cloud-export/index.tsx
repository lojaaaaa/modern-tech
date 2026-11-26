import { queryKeys } from '@/shared/api/query-keys';
import { useState, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CloudUpload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/shared/api/client';
import type { CloudConnection, Resource, Version } from '@/shared/api/types';
import { Modal } from '@/shared/ui/modal';
import { Select } from '@/shared/ui/select';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';

export const CloudExport = ({ version }: { version: Version }) => {
    const operationKey = useRef(crypto.randomUUID());
    const [isOpen, setOpen] = useState(false);
    const [connection, setConnection] = useState('');
    const [path, setPath] = useState('/');

    const connections = useQuery({
        queryKey: [queryKeys.connections],
        queryFn: ({ signal }) => api<Resource<CloudConnection[]>>('/connections', { signal }),
        enabled: isOpen,
    });

    const transfer = useMutation({
        mutationFn: () =>
            api('/transfers', {
                method: 'POST',
                headers: { 'Idempotency-Key': operationKey.current },
                body: JSON.stringify({
                    direction: 'export',
                    connection_id: connection,
                    version_id: version.id,
                    path,
                    filename: version.original_name,
                }),
            }),
    });

    const available = (connections.data?.data ?? []).filter((item) => item.status === 'connected');

    return (
        <div className="export-control">
            <Button variant="secondary" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
                <CloudUpload size={16} /> В облако
            </Button>
            {isOpen && (
                <Modal titleId="export-title" onClose={() => setOpen(false)} isBusy={transfer.isPending}>
                    <h2 id="export-title">Экспорт версии {version.number}</h2>
                    <ErrorMessage error={connections.error || transfer.error} />
                    {transfer.isSuccess ? (
                        <p role="status">
                            Экспорт поставлен в очередь. <Link to="/integrations">Открыть передачи</Link>
                        </p>
                    ) : connections.isPending ? (
                        <p role="status">Загружаем подключения…</p>
                    ) : connections.isError ? (
                        <Button variant="secondary" onClick={() => void connections.refetch()}>
                            Повторить
                        </Button>
                    ) : !available.length ? (
                        <>
                            <p className="muted">Для экспорта нужен подключённый облачный диск.</p>
                            <footer className="modal-actions">
                                <Button variant="secondary" onClick={() => setOpen(false)}>
                                    Отмена
                                </Button>
                                <Button isRenderedAsChild>
                                    <Link to="/integrations?connect=1">Подключить диск</Link>
                                </Button>
                            </footer>
                        </>
                    ) : (
                        <form
                            className="dialog-form"
                            onSubmit={(e) => {
                                e.preventDefault();
                                transfer.mutate();
                            }}
                        >
                            <label>
                                Подключённый диск
                                <Select
                                    label="Подключённый диск"
                                    value={connection}
                                    onValueChange={setConnection}
                                    options={available.map((c) => ({ value: c.id, label: c.name }))}
                                />
                            </label>
                            <label>
                                Папка в облаке
                                <input
                                    required
                                    value={path}
                                    onChange={(e) => setPath(e.target.value)}
                                    placeholder="/Документы"
                                />
                            </label>
                            <p className="muted">
                                Укажите существующую папку от корня диска, например /Документы. Для экспорта в корень
                                оставьте /. Новые папки автоматически не создаются. Файл сохранится отдельной копией с
                                уникальным именем.
                            </p>
                            <footer className="modal-actions">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => setOpen(false)}
                                    disabled={transfer.isPending}
                                >
                                    Отмена
                                </Button>
                                <Button
                                    disabled={transfer.isPending || !available.some((item) => item.id === connection)}
                                >
                                    {transfer.isPending ? 'Добавляем в очередь…' : 'Экспортировать'}
                                </Button>
                            </footer>
                        </form>
                    )}
                </Modal>
            )}
        </div>
    );
};
