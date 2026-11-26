import { formatBytes } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { DataTable, TableSkeleton } from '@/shared/ui/data-table';
import { ErrorMessage } from '@/shared/ui/error-message';
import { FileIcon } from '@/shared/ui/file-icon';
import { ArrowUp, Download } from 'lucide-react';
import type { useIntegrationsModel } from '../model/useIntegrationsModel';

type Props = Pick<ReturnType<typeof useIntegrationsModel>, 'path' | 'setPath' | 'name' | 'files' | 'importFile'>;
export const RemoteFiles = ({ path, setPath, files, importFile }: Props) => (
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
                                <td className="muted">{file.type === 'file' ? formatBytes(file.size) : '—'}</td>
                                <td>
                                    {file.type === 'file' && (
                                        <Button
                                            variant="ghost"
                                            disabled={importFile.isPending || file.size > 52_428_800}
                                            title={file.size > 52_428_800 ? 'Файл превышает лимит 50 МБ' : undefined}
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
);
