import { useState, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CloudUpload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/shared/api/client';
import type { Resource, Version } from '@/shared/api/types';
import { Modal } from '@/shared/ui/modal';
import { Select } from '@/shared/ui/select';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';

export const CloudExport = ({ version }: { version: Version }) => {
    const operationKey = useRef(crypto.randomUUID());
    const [open, setOpen] = useState(false);
    const [connection, setConnection] = useState('');
    const [path, setPath] = useState('/');
    const connections = useQuery({
        queryKey: ['connections'],
        queryFn: ({ signal }) =>
            api<Resource<{ id: string; name: string; status: string }[]>>('/connections', { signal }),
        enabled: open,
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
    return (
        <div className="export-control">
            <Button variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
                <CloudUpload size={16} /> В облако
            </Button>
            {open && (
                <Modal titleId="export-title" onClose={() => setOpen(false)} busy={transfer.isPending}>
                    <header>
                        <h3 id="export-title">Экспорт версии {version.number}</h3>
                        <Button
                            variant="ghost"
                            size="small"
                            onClick={() => setOpen(false)}
                            disabled={transfer.isPending}
                        >
                            Закрыть
                        </Button>
                    </header>
                    <ErrorMessage error={connections.error || transfer.error} />
                    {transfer.isSuccess ? (
                        <p role="status">
                            Экспорт поставлен в очередь. <Link to="/integrations">Открыть передачи</Link>
                        </p>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                transfer.mutate();
                            }}
                        >
                            <label>
                                Мой диск
                                <Select
                                    label="Мой диск"
                                    value={connection}
                                    onValueChange={setConnection}
                                    options={(connections.data?.data ?? [])
                                        .filter((c) => c.status === 'connected')
                                        .map((c) => ({ value: c.id, label: c.name }))}
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
                            <p className="muted">В папке появится отдельная копия с уникальным именем.</p>
                            <Button disabled={transfer.isPending || !connection}>Экспортировать</Button>{' '}
                            <Link to="/integrations">Подключить диск</Link>
                        </form>
                    )}
                </Modal>
            )}
        </div>
    );
};
