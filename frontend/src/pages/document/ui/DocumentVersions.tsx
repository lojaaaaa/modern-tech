import { formatBytes } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Popover } from '@/shared/ui/popover';
import { PageLoader } from '@/shared/ui/spinner';
import { Status } from '@/shared/ui/status';
import { Download, History, Upload } from 'lucide-react';
import type { useDocumentWorkspace } from '../model/useDocumentWorkspace';

type Props = Omit<
    Pick<
        ReturnType<typeof useDocumentWorkspace>,
        | 'id'
        | 'setPublishOpen'
        | 'publicationKeyRef'
        | 'setTab'
        | 'setAnchor'
        | 'setTarget'
        | 'setSelectedVersion'
        | 'fileInput'
        | 'd'
        | 'versions'
        | 'publishDraft'
        | 'version'
    >,
    'd'
> & { d: NonNullable<ReturnType<typeof useDocumentWorkspace>['d']> };
export const DocumentVersions = ({
    setPublishOpen,
    publicationKeyRef,
    setTab,
    setAnchor,
    setTarget,
    setSelectedVersion,
    fileInput,
    d,
    versions,
    publishDraft,
    version,
}: Props) => (
    <div className="version-list">
        <header className="section-heading">
            <h2>История версий</h2>
            <div className="action-group">
                {d.permissions.edit &&
                    (versions.data?.data.filter((item) => item.status === 'ready').length ?? 0) > 1 && (
                        <Button variant="secondary" onClick={() => setTab('compare')}>
                            Сравнить версии
                        </Button>
                    )}
                {d.permissions.edit && (
                    <Popover
                        label="Новая версия"
                        align="end"
                        variant="default"
                        trigger={
                            <>
                                <Upload size={16} /> Новая версия
                            </>
                        }
                    >
                        {(close) => (
                            <div className="menu-actions">
                                <Button
                                    variant="ghost"
                                    disabled={version.isPending}
                                    onClick={() => {
                                        close();
                                        fileInput.current?.click();
                                    }}
                                >
                                    Загрузить файл
                                </Button>
                                {d.permissions.manage && d.version?.original_name.toLowerCase().endsWith('.docx') && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            disabled={publishDraft.isPending}
                                            onClick={() => {
                                                close();
                                                publishDraft.reset();
                                                publicationKeyRef.current = crypto.randomUUID();
                                                setPublishOpen(true);
                                            }}
                                        >
                                            Добавить новую версию
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}
                    </Popover>
                )}
            </div>
        </header>
        <ErrorMessage error={versions.error} />
        {versions.isPending && <PageLoader />}
        {!versions.isPending && !versions.isError && !versions.data?.data.length && (
            <p className="muted">Версий пока нет.</p>
        )}
        {!d.permissions.edit && (
            <p className="muted">Предпросмотр предыдущих версий доступен участникам с правом редактирования.</p>
        )}
        {versions.data?.data
            .filter((v) => d.permissions.edit || v.id === d.version?.id)
            .map((v) => (
                <article key={v.id}>
                    <span className="file-icon blue">
                        <History size={20} />
                    </span>
                    <div>
                        <div className="version-label">
                            <strong>Версия {v.number}</strong>
                            {v.id === d.version?.id && <span className="count-pill">Текущая</span>}
                        </div>
                        <small>
                            {v.original_name} · {formatBytes(v.size)}
                            {v.created_at && ` · ${new Date(v.created_at).toLocaleString('ru-RU')}`}
                            {v.creator_name && ` · ${v.creator_name}`}
                        </small>
                    </div>
                    <Status value={v.status} />
                    {v.status === 'ready' && (
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => {
                                setSelectedVersion(v.id);
                                setTarget(null);
                                setAnchor(null);
                                setTab('preview');
                            }}
                        >
                            Открыть версию {v.number}
                        </Button>
                    )}
                    {v.status === 'ready' && d.permissions.export && (
                        <Button isRenderedAsChild variant="secondary" size="icon" className="version-download">
                            <a href={`/api/v1/versions/${v.id}/download`} aria-label={`Скачать версию ${v.number}`}>
                                <Download size={17} />
                            </a>
                        </Button>
                    )}
                </article>
            ))}
    </div>
);
