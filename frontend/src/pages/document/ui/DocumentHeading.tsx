import { CloudExport } from '@/features/cloud-export';
import { formatBytes, formatDate } from '@/shared/lib/utils';
import { ActionMenu } from '@/shared/ui/action-menu';
import { Button } from '@/shared/ui/button';
import { Status } from '@/shared/ui/status';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { useDocumentWorkspace } from '../model/useDocumentWorkspace';

type Props = Omit<
    Pick<ReturnType<typeof useDocumentWorkspace>, 'id' | 'setConfirmDelete' | 'd' | 'versions' | 'version'>,
    'd'
> & { d: NonNullable<ReturnType<typeof useDocumentWorkspace>['d']> };
export const DocumentHeading = ({ setConfirmDelete, d }: Props) => {
    const location = useLocation();
    const librarySearch = location.state?.librarySearch;

    return (
        <div className="page-heading document-heading">
            <div>
                <Link
                    className="document-return"
                    aria-label="Вернуться в библиотеку"
                    title="Вернуться в библиотеку"
                    to={typeof librarySearch === 'string' && librarySearch ? `/?${librarySearch}` : '/'}
                >
                    <ArrowLeft size={15} />
                </Link>
                <div className="document-title-line">
                    <h1 className="detail-title" title={d.title}>
                        {d.title}
                    </h1>
                    {d.processing_status === 'ready' ? (
                        <span
                            className="document-ready-dot"
                            role="img"
                            aria-label="Документ обработан"
                            title="Документ обработан"
                        />
                    ) : (
                        <Status value={d.processing_status ?? 'quarantined'} />
                    )}
                </div>
                <p className="muted">
                    {d.owner.name} · {formatDate(d.updated_at)}
                    {d.version && ` · Версия ${d.version.number} · ${formatBytes(d.version.size)}`}
                </p>
            </div>
            <div className="action-group">
                {d.permissions.export && d.version?.status === 'ready' && (
                    <Button isRenderedAsChild>
                        <a href={`/api/v1/versions/${d.version.id}/download`}>
                            <Download size={16} />
                            Скачать
                        </a>
                    </Button>
                )}
                {(d.permissions.manage || (d.permissions.export && d.version?.status === 'ready')) && (
                    <ActionMenu label="Действия с документом">
                        {(close) => (
                            <div className="menu-actions">
                                {d.permissions.export && d.version?.status === 'ready' && (
                                    <CloudExport key={d.version.id} version={d.version} />
                                )}
                                {d.permissions.manage && (
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            close();
                                            setConfirmDelete(true);
                                        }}
                                    >
                                        <Trash2 size={16} /> Переместить в корзину
                                    </Button>
                                )}
                            </div>
                        )}
                    </ActionMenu>
                )}
            </div>
        </div>
    );
};
