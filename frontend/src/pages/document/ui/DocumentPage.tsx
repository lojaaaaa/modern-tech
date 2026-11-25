import { queryKeys } from '@/shared/api/query-keys';
import { Info, Maximize, MoreHorizontal } from 'lucide-react';
import { lazy, Suspense, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, FileText, History, Upload, Shield, Eye } from 'lucide-react';
import { FilePreview, TextReader, type TextAnchor, type AnchorTarget } from '@/features/document-reader';
import { CloudExport } from '@/features/cloud-export';
import { api } from '@/shared/api/client';
import type { DocumentRecord, DocumentSearchMatch, Resource, Version, CommentRecord } from '@/shared/api/types';
import { AlertDialog } from '@/shared/ui/alert-dialog';
import { Popover } from '@/shared/ui/popover';
import { Modal } from '@/shared/ui/modal';
import { Button } from '@/shared/ui/button';
import { Status } from '@/shared/ui/status';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes, formatDate } from '@/shared/lib/utils';
import { AccessEditor } from './AccessEditor';
import { DiscussionPanel } from './DiscussionPanel';
import { OfficeEditor } from './OfficeEditor';

const VersionCompare = lazy(() =>
    import('@/features/version-compare').then((module) => ({ default: module.VersionCompare }))
);

type HistoryVersion = Version & { created_at?: string; creator_name?: string };

export const DocumentPage = () => {
    const { id } = useParams();
    const location = useLocation();
    return <DocumentWorkspace key={`${id}:${location.key}`} searchMatch={location.state?.searchMatch} />;
};

const DocumentWorkspace = ({ searchMatch }: { searchMatch?: DocumentSearchMatch }) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const client = useQueryClient();
    const [isDeleteConfirmationOpen, setConfirmDelete] = useState(false);
    const [isPublishOpen, setPublishOpen] = useState(false);
    const publicationKey = useRef('');
    const [isDiscussionOpen, setDiscussionOpen] = useState(false);
    const [tab, setTab] = useState<'preview' | 'text' | 'versions' | 'access' | 'compare' | 'entities' | 'editor'>(
        searchMatch ? 'text' : 'preview'
    );
    const [isSearchDismissed, setSearchDismissed] = useState(false);
    const isDiscussionVisible = tab === 'preview' || tab === 'text';
    const [anchor, setAnchor] = useState<TextAnchor | null>(null);
    const [target, setTarget] = useState<AnchorTarget | null>(null);
    const [newCommentId, setNewCommentId] = useState<string | null>(null);
    const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
    const readerPanel = useRef<HTMLElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const doc = useQuery({
        queryKey: [queryKeys.document, id],
        queryFn: ({ signal }) => api<Resource<DocumentRecord>>(`/documents/${id}`, { signal }),
        refetchInterval: (q) =>
            ['quarantined', 'scanning', 'extracting'].includes(q.state.data?.data.processing_status ?? '')
                ? 4000
                : false,
    });
    const d = doc.data?.data;
    const activeVersionId = selectedVersion ?? d?.version?.id;
    const versions = useQuery({
        queryKey: [queryKeys.versions, id, d?.processing_status],
        queryFn: ({ signal }) => api<Resource<HistoryVersion[]>>(`/documents/${id}/versions`, { signal }),
        enabled: !!d && (tab === 'versions' || tab === 'compare' || selectedVersion !== null),
    });
    const draftStatus = useQuery({
        queryKey: [queryKeys.document, id, 'draft-publication'],
        queryFn: ({ signal }) =>
            api<Resource<{ available: boolean; reason: string | null }>>(`/documents/${id}/draft/publication`, {
                signal,
            }),
        enabled:
            tab === 'versions' && !!d?.permissions.manage && !!d.version?.original_name.toLowerCase().endsWith('.docx'),
        refetchInterval: (query) => (query.state.data?.data.available === false ? 7000 : false),
    });
    const publishDraft = useMutation({
        mutationFn: () =>
            api(`/documents/${id}/draft/publication`, {
                method: 'POST',
                headers: { 'Idempotency-Key': publicationKey.current },
            }),
        onSuccess: async () => {
            setPublishOpen(false);
            await Promise.all([
                client.invalidateQueries({ queryKey: [queryKeys.document, id] }),
                client.invalidateQueries({ queryKey: [queryKeys.versions, id] }),
                client.invalidateQueries({ queryKey: [queryKeys.documents] }),
            ]);
        },
    });
    const activeVersion = selectedVersion
        ? selectedVersion === d?.version?.id || d?.permissions.edit
            ? versions.data?.data.find((version) => version.id === selectedVersion)
            : undefined
        : d?.version;
    const isImage = activeVersion?.mime.startsWith('image/') ?? false;
    const text = useQuery({
        queryKey: [queryKeys.documentText, activeVersionId],
        queryFn: ({ signal }) =>
            api<Resource<{ text: string | null; status: string }>>(`/versions/${activeVersionId}/text`, {
                signal,
            }),
        enabled:
            !!activeVersionId &&
            activeVersion?.status === 'ready' &&
            (tab === 'text' || (tab === 'preview' && /\.(txt|md|csv)$/i.test(activeVersion.original_name))),
    });
    const extractedText = text.data?.data.text;
    const searchTarget = useMemo(() => {
        if (!searchMatch || isSearchDismissed || !extractedText || searchMatch.version_id !== activeVersionId) {
            return null;
        }
        let start = 0;
        let characters = 0;
        for (const character of extractedText) {
            if (characters === searchMatch.start) {
                break;
            }
            start += character.length;
            characters += 1;
        }
        const end = start + searchMatch.quote.length;
        return extractedText.slice(start, end) === searchMatch.quote ? { start, end, quote: searchMatch.quote } : null;
    }, [searchMatch, isSearchDismissed, extractedText, activeVersionId]);
    const entities = useQuery({
        queryKey: [queryKeys.entities, activeVersionId],
        queryFn: ({ signal }) =>
            api<Resource<{ id: number; type: string; value: string }[]>>(`/versions/${activeVersionId}/entities`, {
                signal,
            }),
        enabled: !!activeVersionId && !isImage && activeVersion?.status === 'ready',
    });
    const comments = useQuery({
        queryKey: [queryKeys.comments, id],
        queryFn: ({ signal }) => api<Resource<CommentRecord[]>>(`/documents/${id}/comments`, { signal }),
        enabled: !!d && tab !== 'editor' && (d.permissions.comment || d.permissions.edit),
        refetchInterval: isDiscussionOpen && isDiscussionVisible ? 5000 : false,
    });
    const remove = useMutation({
        mutationFn: () => api(`/documents/${id}`, { method: 'DELETE' }),
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: [queryKeys.documents] });
            navigate('/');
        },
    });
    const version = useMutation({
        mutationFn: (file: File) => {
            const body = new FormData();
            body.append('file', file);
            return api(`/documents/${id}/versions`, {
                method: 'POST',
                body,
                headers: { 'Idempotency-Key': crypto.randomUUID() },
            });
        },
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: [queryKeys.document, id] });
            await client.invalidateQueries({ queryKey: [queryKeys.versions, id] });
        },
    });
    const chooseAnchor = (value: TextAnchor) => {
        setSelectedVersion(activeVersionId ?? null);
        setAnchor(value);
        setDiscussionOpen(true);
    };
    const jumpToComment = (c: CommentRecord) => {
        if (c.version_id !== d?.version?.id && !d?.permissions.edit) {
            return;
        }
        if (target?.key === c.id) {
            setTarget(null);
            return;
        }
        if (c.anchor_start === null || c.anchor_end === null || !c.anchor_quote) {
            return;
        }
        setSelectedVersion(c.version_id);
        setAnchor(null);
        setTab('text');
        setTarget({
            start: c.anchor_start,
            end: c.anchor_end,
            quote: c.anchor_quote,
            key: c.id,
        });
    };
    const reader = (
        <>
            {tab === 'text' && searchMatch && !isSearchDismissed && !searchTarget && !text.isFetching && (
                <p role="status" className="search-match-notice">
                    Исходное совпадение больше недоступно в этой версии.
                </p>
            )}
            {text.isPending ? (
                <div className="empty-state" role="status">
                    Загружаем текст…
                </div>
            ) : text.data?.data.text?.trim() ? (
                <TextReader
                    key={activeVersionId}
                    text={text.data.data.text}
                    isCommentAllowed={!!d?.permissions.comment}
                    target={target}
                    searchTarget={tab === 'text' ? searchTarget : null}
                    onDismissSearch={() => setSearchDismissed(true)}
                    activeComment={comments.data?.data.find((c) => c.id === target?.key) ?? null}
                    comments={(comments.data?.data ?? []).filter((comment) => comment.version_id === activeVersionId)}
                    onSelectComment={(comment) => {
                        setDiscussionOpen(true);
                        jumpToComment(comment);
                    }}
                    onComment={chooseAnchor}
                    onSubmitComment={async (selected, body) => {
                        const result = await api<Resource<{ id: string }>>(`/documents/${id}/comments`, {
                            method: 'POST',
                            headers: { 'Idempotency-Key': crypto.randomUUID() },
                            body: JSON.stringify({
                                body,
                                version_id: activeVersionId,
                                anchor_start: selected.start,
                                anchor_end: selected.end,
                                anchor_quote: selected.quote,
                            }),
                        });
                        setNewCommentId(result.data.id);
                        await client.invalidateQueries({ queryKey: [queryKeys.comments, id] });
                    }}
                />
            ) : (
                <div className="empty-state">В документе нет распознанного текста.</div>
            )}
            <ErrorMessage error={text.error} />
        </>
    );
    return (
        <>
            {isPublishOpen && (
                <Modal
                    titleId="publish-draft-title"
                    onClose={() => setPublishOpen(false)}
                    isBusy={publishDraft.isPending}
                >
                    <h2 id="publish-draft-title">Создать версию из черновика</h2>
                    <p className="muted">Сохранённый черновик станет опубликованной версией после обработки.</p>
                    <ErrorMessage error={publishDraft.error} />
                    <footer>
                        <Button
                            variant="secondary"
                            disabled={publishDraft.isPending}
                            onClick={() => setPublishOpen(false)}
                        >
                            Отмена
                        </Button>
                        <Button disabled={publishDraft.isPending} onClick={() => publishDraft.mutate()}>
                            {publishDraft.isPending ? 'Создаём…' : 'Создать версию'}
                        </Button>
                    </footer>
                </Modal>
            )}
            {isDeleteConfirmationOpen && (
                <AlertDialog
                    title="Переместить в корзину?"
                    description="Документ можно будет восстановить."
                    confirmLabel="В корзину"
                    isBusy={remove.isPending}
                    error={remove.error}
                    onClose={() => setConfirmDelete(false)}
                    onConfirm={() => remove.mutate()}
                />
            )}
            <ErrorMessage error={doc.error || remove.error || version.error} />
            {doc.isPending && (
                <div className="empty-state" role="status">
                    Загружаем документ…
                </div>
            )}
            {d && (
                <>
                    <div className="page-heading document-heading">
                        <div>
                            <div className="document-title-line">
                                <h1 className="detail-title" title={d.title}>
                                    {d.title}
                                </h1>
                                <Status value={d.processing_status ?? 'quarantined'} />
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
                                <Popover
                                    align="end"
                                    label="Действия с документом"
                                    trigger={<MoreHorizontal size={18} />}
                                >
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
                                </Popover>
                            )}
                        </div>
                    </div>
                    <input
                        hidden
                        type="file"
                        ref={fileInput}
                        accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                version.mutate(file);
                            }
                            e.target.value = '';
                        }}
                    />
                    <div
                        className={`detail-grid document-layout ${isDiscussionOpen && isDiscussionVisible ? 'discussion-open' : ''}`}
                    >
                        <section
                            ref={readerPanel}
                            className={`content-panel reader-panel ${tab === 'preview' ? 'preview-panel' : ''}`}
                            style={
                                tab === 'editor'
                                    ? { gridColumn: '1 / -1' }
                                    : tab === 'versions'
                                      ? { height: 'auto', alignSelf: 'start' }
                                      : undefined
                            }
                        >
                            <div className="document-view-toolbar">
                                <div className="tabs" role="group" aria-label="Разделы документа">
                                    {(d.permissions.edit || d.permissions.comment) &&
                                        /\.docx$/i.test(d.version?.original_name ?? '') &&
                                        d.version?.status === 'ready' && (
                                            <button
                                                aria-pressed={tab === 'editor'}
                                                className={tab === 'editor' ? 'active' : ''}
                                                onClick={() => {
                                                    setSelectedVersion(null);
                                                    setTab('editor');
                                                }}
                                            >
                                                Совместная работа
                                            </button>
                                        )}
                                    {!isImage && !!entities.data?.data.length && (
                                        <button
                                            aria-pressed={tab === 'entities'}
                                            className={tab === 'entities' ? 'active' : ''}
                                            onClick={() => setTab('entities')}
                                        >
                                            Данные
                                        </button>
                                    )}
                                    <button
                                        aria-pressed={tab === 'preview'}
                                        className={tab === 'preview' ? 'active' : ''}
                                        onClick={() => setTab('preview')}
                                    >
                                        <Eye size={16} />
                                        Предпросмотр
                                    </button>
                                    <button
                                        aria-pressed={tab === 'text'}
                                        className={tab === 'text' ? 'active' : ''}
                                        onClick={() => setTab('text')}
                                    >
                                        <FileText size={16} />
                                        Текст документа
                                    </button>
                                    <button
                                        aria-pressed={tab === 'versions'}
                                        className={tab === 'versions' ? 'active' : ''}
                                        onClick={() => setTab('versions')}
                                    >
                                        <History size={16} />
                                        Версии
                                    </button>
                                    {d.permissions.manage && (
                                        <button
                                            aria-pressed={tab === 'access'}
                                            className={tab === 'access' ? 'active' : ''}
                                            onClick={() => setTab('access')}
                                        >
                                            <Shield size={16} />
                                            Доступ
                                        </button>
                                    )}
                                </div>
                                <div className="document-view-tools">
                                    {(isDiscussionVisible || tab === 'editor' || tab === 'compare') && (
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            aria-label="Полноэкранный просмотр"
                                            onClick={() => {
                                                if (document.fullscreenElement) {
                                                    void document.exitFullscreen();
                                                } else {
                                                    void readerPanel.current?.requestFullscreen();
                                                }
                                            }}
                                        >
                                            <Maximize size={16} />
                                            На весь экран
                                        </Button>
                                    )}
                                    {isDiscussionVisible && (
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            aria-expanded={isDiscussionOpen}
                                            onClick={() => setDiscussionOpen((isOpen) => !isOpen)}
                                        >
                                            {isDiscussionOpen ? 'Скрыть обсуждение' : 'Обсуждение'}
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {selectedVersion && selectedVersion !== d.version?.id && (
                                <div className="version-notice">
                                    {activeVersion ? `Версия ${activeVersion.number}` : 'Загружаем версию…'}
                                    <Button
                                        variant="ghost"
                                        size="small"
                                        onClick={() => {
                                            setSelectedVersion(null);
                                            setTarget(null);
                                            setAnchor(null);
                                        }}
                                    >
                                        Текущая версия
                                    </Button>
                                    <Button variant="ghost" size="small" onClick={() => setTab('versions')}>
                                        Все версии
                                    </Button>
                                </div>
                            )}
                            {tab === 'preview' &&
                                activeVersionId &&
                                (activeVersion?.status === 'ready' ? (
                                    <FilePreview key={activeVersionId} versionId={activeVersionId} fallback={reader} />
                                ) : selectedVersion && versions.isPending ? (
                                    <div className="empty-state" role="status">
                                        Загружаем версию…
                                    </div>
                                ) : selectedVersion && (versions.isError || !activeVersion) ? (
                                    <div className="empty-state">
                                        Не удалось открыть версию. Вернитесь к списку и попробуйте снова.
                                    </div>
                                ) : (
                                    <div className="empty-state">Предпросмотр этой версии пока недоступен.</div>
                                ))}
                            {tab === 'editor' && (
                                <>
                                    <div className="draft-toolbar">
                                        <Popover
                                            label="Рабочий черновик"
                                            trigger={
                                                <>
                                                    <Info size={16} /> Рабочий черновик
                                                </>
                                            }
                                        >
                                            <p className="filter-fields">
                                                Изменения сохраняются после выхода последнего участника. Чтобы открыть
                                                сохранённый черновик, перейдите в «Совместная работа». Предпросмотр
                                                показывает опубликованную версию.
                                            </p>
                                        </Popover>
                                    </div>
                                    <OfficeEditor documentId={d.id} />
                                </>
                            )}
                            {tab === 'text' && reader}
                            {tab === 'entities' && !isImage && (
                                <div className="access-editor">
                                    <p>
                                        Сущности определяются по простым правилам: даты, email, суммы и некоторые
                                        названия российских организаций. Возможны пропуски и ложные совпадения;
                                        результат не является полноценным распознаванием имён и организаций.
                                    </p>
                                    <ErrorMessage error={entities.error} />
                                    {entities.isPending ? (
                                        <p>Загрузка…</p>
                                    ) : entities.data?.data.length ? (
                                        Array.from(
                                            entities.data.data
                                                .reduce((groups, entity) => {
                                                    const key =
                                                        entity.type +
                                                        ':' +
                                                        entity.value
                                                            .toLocaleLowerCase()
                                                            .replace(/[«»“”"]/g, '')
                                                            .replace(/\s+/g, ' ')
                                                            .trim();
                                                    const existing = groups.get(key);
                                                    if (existing) {
                                                        existing.count++;
                                                    } else {
                                                        groups.set(key, { ...entity, count: 1 });
                                                    }
                                                    return groups;
                                                }, new Map<string, { id: number; type: string; value: string; count: number }>())
                                                .values()
                                        ).map((entity) => (
                                            <div className="grant-row" key={entity.id}>
                                                <small>
                                                    {(
                                                        {
                                                            date: 'Дата',
                                                            email: 'Email',
                                                            amount: 'Сумма',
                                                            organization: 'Организация',
                                                        } as Record<string, string>
                                                    )[entity.type] ?? 'Данные'}
                                                </small>
                                                <span>{entity.value}</span>
                                                {entity.count > 1 && <span className="count-pill">{entity.count}</span>}
                                            </div>
                                        ))
                                    ) : (
                                        <p className="muted">
                                            Данные не найдены. Для ранее загруженных документов требуется повторная
                                            обработка.
                                        </p>
                                    )}
                                </div>
                            )}
                            {tab === 'compare' && (
                                <>
                                    <Button variant="ghost" onClick={() => setTab('versions')}>
                                        ← История версий
                                    </Button>
                                    <Suspense fallback={<div className="empty-state">Загрузка…</div>}>
                                        <VersionCompare
                                            versions={
                                                versions.data?.data.filter((item) => item.status === 'ready') ?? []
                                            }
                                        />
                                    </Suspense>
                                </>
                            )}
                            {tab === 'versions' && (
                                <div className="version-list">
                                    <header className="section-heading">
                                        <h2>История версий</h2>
                                        <div className="action-group">
                                            {d.permissions.edit &&
                                                (versions.data?.data.filter((item) => item.status === 'ready').length ??
                                                    0) > 1 && (
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
                                                            {d.permissions.manage &&
                                                                d.version?.original_name
                                                                    .toLowerCase()
                                                                    .endsWith('.docx') && (
                                                                    <>
                                                                        <Button
                                                                            variant="ghost"
                                                                            disabled={!draftStatus.data?.data.available}
                                                                            onClick={() => {
                                                                                close();
                                                                                publishDraft.reset();
                                                                                publicationKey.current =
                                                                                    crypto.randomUUID();
                                                                                setPublishOpen(true);
                                                                            }}
                                                                        >
                                                                            Создать версию из черновика
                                                                        </Button>
                                                                        {draftStatus.data?.data.reason && (
                                                                            <small className="muted menu-note">
                                                                                {draftStatus.data.data.reason}
                                                                            </small>
                                                                        )}
                                                                    </>
                                                                )}
                                                        </div>
                                                    )}
                                                </Popover>
                                            )}
                                        </div>
                                    </header>
                                    <ErrorMessage error={versions.error} />
                                    {versions.isPending && <p role="status">Загружаем версии…</p>}
                                    {!versions.isPending && !versions.isError && !versions.data?.data.length && (
                                        <p className="muted">Версий пока нет.</p>
                                    )}
                                    {!d.permissions.edit && (
                                        <p className="muted">
                                            Предпросмотр предыдущих версий доступен участникам с правом редактирования.
                                        </p>
                                    )}
                                    {versions.data?.data
                                        .filter((v) => d.permissions.edit || v.id === d.version?.id)
                                        .map((v) => (
                                            <article key={v.id}>
                                                <span className="file-icon blue">
                                                    <History size={20} />
                                                </span>
                                                <div>
                                                    <strong>Версия {v.number}</strong>
                                                    {v.id === d.version?.id && (
                                                        <span className="count-pill">Текущая</span>
                                                    )}
                                                    <small>
                                                        {v.original_name} · {formatBytes(v.size)}
                                                        {v.created_at &&
                                                            ` · ${new Date(v.created_at).toLocaleString('ru-RU')}`}
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
                                                    <Button
                                                        isRenderedAsChild
                                                        variant="secondary"
                                                        size="icon"
                                                        className="version-download"
                                                    >
                                                        <a
                                                            href={`/api/v1/versions/${v.id}/download`}
                                                            aria-label={`Скачать версию ${v.number}`}
                                                        >
                                                            <Download size={17} />
                                                        </a>
                                                    </Button>
                                                )}
                                            </article>
                                        ))}
                                </div>
                            )}
                            {tab === 'access' && <AccessEditor id={d.id} owner={d.owner} />}
                        </section>
                        {isDiscussionOpen && isDiscussionVisible && !d.permissions.edit && !d.permissions.comment ? (
                            <aside className="content-panel comments-panel">
                                <p className="muted">Обсуждения опубликованной версии пока недоступны.</p>
                            </aside>
                        ) : (
                            isDiscussionOpen &&
                            isDiscussionVisible && (
                                <DiscussionPanel
                                    documentId={d.id}
                                    versionId={activeVersionId}
                                    isCommentAllowed={d.permissions.comment}
                                    comments={comments.data?.data ?? []}
                                    error={comments.error}
                                    anchor={anchor}
                                    newCommentId={newCommentId}
                                    onCommentCreated={setNewCommentId}
                                    onCommentShown={() => setNewCommentId(null)}
                                    onClearAnchor={() => setAnchor(null)}
                                    onJump={jumpToComment}
                                    onClose={() => setDiscussionOpen(false)}
                                />
                            )
                        )}
                    </div>
                </>
            )}
        </>
    );
};
