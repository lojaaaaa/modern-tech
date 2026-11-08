import { Maximize } from 'lucide-react';
import { lazy, Suspense, useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Trash2, FileText, History, Upload, Shield, Eye } from 'lucide-react';
import { FilePreview, TextReader, type TextAnchor, type AnchorTarget } from '@/features/document-reader';
import { CloudExport } from '@/features/cloud-export';
import { api } from '@/shared/api/client';
import type { DocumentRecord, Resource, Version, CommentRecord } from '@/shared/api/types';
import { Select } from '@/shared/ui/select';
import { Modal } from '@/shared/ui/modal';
import { Button } from '@/shared/ui/button';
import { Status } from '@/shared/ui/status';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes, formatDate } from '@/shared/lib/utils';
import { DiscussionPanel } from './DiscussionPanel';
import { OfficeEditor } from './OfficeEditor';

const VersionCompare = lazy(() =>
    import('@/features/version-compare').then((module) => ({ default: module.VersionCompare }))
);

export const DocumentPage = () => {
    const { id } = useParams();
    return <DocumentWorkspace key={id} />;
};

const DocumentWorkspace = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const client = useQueryClient();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [discussionOpen, setDiscussionOpen] = useState(false);
    const [tab, setTab] = useState<'preview' | 'text' | 'versions' | 'access' | 'compare' | 'entities' | 'editor'>(
        'preview'
    );
    const showDiscussion = tab === 'preview' || tab === 'text';
    const [anchor, setAnchor] = useState<TextAnchor | null>(null);
    const [target, setTarget] = useState<AnchorTarget | null>(null);
    const [newCommentId, setNewCommentId] = useState<string | null>(null);
    const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
    const readerPanel = useRef<HTMLElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const doc = useQuery({
        queryKey: ['document', id],
        queryFn: ({ signal }) => api<Resource<DocumentRecord>>(`/documents/${id}`, { signal }),
        refetchInterval: (q) =>
            ['quarantined', 'scanning', 'extracting'].includes(q.state.data?.data.processing_status ?? '')
                ? 4000
                : false,
    });
    const d = doc.data?.data;
    const activeVersionId = selectedVersion ?? d?.version?.id;
    const versions = useQuery({
        queryKey: ['versions', id, d?.processing_status],
        queryFn: ({ signal }) => api<Resource<Version[]>>(`/documents/${id}/versions`, { signal }),
        enabled: !!d && (tab === 'versions' || tab === 'compare' || selectedVersion !== null),
    });
    const activeVersion = selectedVersion
        ? selectedVersion === d?.version?.id || d?.permissions.edit
            ? versions.data?.data.find((version) => version.id === selectedVersion)
            : undefined
        : d?.version;
    const isImage = activeVersion?.mime.startsWith('image/') ?? false;
    const text = useQuery({
        queryKey: ['document-text', activeVersionId],
        queryFn: ({ signal }) =>
            api<Resource<{ text: string | null; status: string }>>(`/versions/${activeVersionId}/text`, {
                signal,
            }),
        enabled:
            !!activeVersionId &&
            activeVersion?.status === 'ready' &&
            (tab === 'text' || (tab === 'preview' && /\.(txt|md|csv)$/i.test(activeVersion.original_name))),
    });
    const entities = useQuery({
        queryKey: ['entities', activeVersionId],
        queryFn: ({ signal }) =>
            api<Resource<{ id: number; type: string; value: string }[]>>(`/versions/${activeVersionId}/entities`, {
                signal,
            }),
        enabled: !!activeVersionId && !isImage && tab === 'entities',
    });
    const comments = useQuery({
        queryKey: ['comments', id],
        queryFn: ({ signal }) => api<Resource<CommentRecord[]>>(`/documents/${id}/comments`, { signal }),
        enabled: !!d && tab !== 'editor' && (d.permissions.comment || d.permissions.edit),
    });
    const remove = useMutation({
        mutationFn: () => api(`/documents/${id}`, { method: 'DELETE' }),
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: ['documents'] });
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
            await client.invalidateQueries({ queryKey: ['document', id] });
            await client.invalidateQueries({ queryKey: ['versions', id] });
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
            {text.isPending ? (
                <div className="empty-state" role="status">
                    Загружаем текст…
                </div>
            ) : text.data?.data.text?.trim() ? (
                <TextReader
                    key={activeVersionId}
                    text={text.data.data.text}
                    canComment={!!d?.permissions.comment}
                    target={target}
                    activeComment={comments.data?.data.find((c) => c.id === target?.key) ?? null}
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
                        await client.invalidateQueries({ queryKey: ['comments', id] });
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
            {confirmDelete && (
                <Modal titleId="delete-title" onClose={() => setConfirmDelete(false)} busy={remove.isPending}>
                    <h2 id="delete-title">Переместить в корзину?</h2>
                    <p className="muted">Документ можно будет восстановить.</p>
                    <ErrorMessage error={remove.error} />
                    <footer>
                        <Button variant="secondary" disabled={remove.isPending} onClick={() => setConfirmDelete(false)}>
                            Отмена
                        </Button>
                        <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                            В корзину
                        </Button>
                    </footer>
                </Modal>
            )}
            <Link to="/" className="back-link">
                <ArrowLeft size={16} />
                Все документы
            </Link>
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
                            <div className="eyebrow">ДОКУМЕНТ · ВЕРСИЯ {d.version?.number ?? '—'}</div>
                            <div className="document-title-line">
                                <h1 className="detail-title">{d.title}</h1>
                                <Status value={d.processing_status ?? 'quarantined'} />
                            </div>
                            <p className="muted">
                                {d.owner.name} · {formatDate(d.updated_at)} · {d.version && formatBytes(d.version.size)}
                            </p>
                        </div>
                        <div className="action-group">
                            {d.permissions.edit && (
                                <Button
                                    variant="secondary"
                                    onClick={() => fileInput.current?.click()}
                                    disabled={version.isPending}
                                >
                                    <Upload size={16} />
                                    Новая версия
                                </Button>
                            )}
                            {d.permissions.export && d.version?.status === 'ready' && (
                                <Button asChild>
                                    <a href={`/api/v1/versions/${d.version.id}/download`}>
                                        <Download size={16} />
                                        Скачать
                                    </a>
                                </Button>
                            )}
                            {d.permissions.export && d.version?.status === 'ready' && (
                                <CloudExport key={d.version.id} version={d.version} />
                            )}
                            {d.permissions.manage && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Переместить в корзину"
                                    onClick={() => setConfirmDelete(true)}
                                >
                                    <Trash2 size={18} />
                                </Button>
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
                        className={`detail-grid document-layout ${discussionOpen && showDiscussion ? 'discussion-open' : ''}`}
                    >
                        <section
                            ref={readerPanel}
                            className="content-panel reader-panel"
                            style={
                                tab === 'editor'
                                    ? { gridColumn: '1 / -1' }
                                    : tab === 'versions'
                                      ? { height: 'auto', alignSelf: 'start' }
                                      : undefined
                            }
                        >
                            <div className="document-view-toolbar">
                                <div className="tabs">
                                    {(d.permissions.edit || d.permissions.comment) &&
                                        /\.docx$/i.test(d.version?.original_name ?? '') &&
                                        d.version?.status === 'ready' && (
                                            <button
                                                className={tab === 'editor' ? 'active' : ''}
                                                onClick={() => {
                                                    setSelectedVersion(null);
                                                    setTab('editor');
                                                }}
                                            >
                                                Совместная работа
                                            </button>
                                        )}
                                    {!isImage && (
                                        <button
                                            className={tab === 'entities' ? 'active' : ''}
                                            onClick={() => setTab('entities')}
                                        >
                                            Данные
                                        </button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
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
                                    </Button>
                                    <button
                                        className={tab === 'preview' ? 'active' : ''}
                                        onClick={() => setTab('preview')}
                                    >
                                        <Eye size={16} />
                                        Предпросмотр
                                    </button>
                                    <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>
                                        <FileText size={16} />
                                        Текст
                                    </button>
                                    <button
                                        className={tab === 'versions' ? 'active' : ''}
                                        onClick={() => setTab('versions')}
                                    >
                                        <History size={16} />
                                        Версии
                                    </button>
                                    {d.permissions.manage && (
                                        <button
                                            className={tab === 'access' ? 'active' : ''}
                                            onClick={() => setTab('access')}
                                        >
                                            <Shield size={16} />
                                            Доступ
                                        </button>
                                    )}
                                </div>
                                <div className="document-view-tools">
                                    {showDiscussion && (
                                        <Button
                                            variant="secondary"
                                            size="small"
                                            aria-expanded={discussionOpen}
                                            onClick={() => setDiscussionOpen((open) => !open)}
                                        >
                                            {discussionOpen ? 'Скрыть обсуждение' : 'Обсуждение'}
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
                            {tab === 'editor' && <OfficeEditor documentId={d.id} />}
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
                                <Suspense fallback={<div className="empty-state">Загрузка…</div>}>
                                    <VersionCompare versions={versions.data?.data ?? []} />
                                </Suspense>
                            )}
                            {tab === 'versions' && (
                                <div className="version-list">
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
                                    {d.permissions.edit && (versions.data?.data.length ?? 0) > 1 && (
                                        <Button variant="secondary" onClick={() => setTab('compare')}>
                                            Сравнить версии
                                        </Button>
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
                                                    <small>
                                                        {v.original_name} · {formatBytes(v.size)}
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
                                                    <a
                                                        href={`/api/v1/versions/${v.id}/download`}
                                                        aria-label={`Скачать версию ${v.number}`}
                                                    >
                                                        <Download size={17} />
                                                    </a>
                                                )}
                                            </article>
                                        ))}
                                </div>
                            )}
                            {tab === 'access' && <AccessEditor id={d.id} />}
                        </section>
                        {discussionOpen && showDiscussion && !d.permissions.edit && !d.permissions.comment ? (
                            <aside className="content-panel comments-panel">
                                <p className="muted">Обсуждения опубликованной версии пока недоступны.</p>
                            </aside>
                        ) : (
                            discussionOpen &&
                            showDiscussion && (
                                <DiscussionPanel
                                    documentId={d.id}
                                    versionId={activeVersionId}
                                    canComment={d.permissions.comment}
                                    comments={comments.data?.data ?? []}
                                    error={comments.error}
                                    anchor={anchor}
                                    newCommentId={newCommentId}
                                    onCommentCreated={setNewCommentId}
                                    onCommentShown={() => setNewCommentId(null)}
                                    onClearAnchor={() => setAnchor(null)}
                                    onJump={jumpToComment}
                                />
                            )
                        )}
                    </div>
                </>
            )}
        </>
    );
};

interface Grant {
    user_id: number;
    read: boolean;
    comment: boolean;
    edit: boolean;
    export: boolean;
}
const AccessEditor = ({ id }: { id: string }) => {
    const participants = useQuery({
        queryKey: ['participants', id],
        queryFn: ({ signal }) =>
            api<Resource<{ id: number; name: string; role: string }[]>>(`/documents/${id}/participants`, { signal }),
    });
    const client = useQueryClient();
    const [userId, setUserId] = useState('');
    const [rights, setRights] = useState({ comment: false, edit: false, export: false });
    const query = useQuery({
        queryKey: ['grants', id],
        queryFn: ({ signal }) => api<Resource<Grant[]>>(`/documents/${id}/grants`, { signal }),
    });
    const update = useMutation({
        mutationFn: (grants: Grant[]) =>
            api(`/documents/${id}/grants`, { method: 'PUT', body: JSON.stringify({ grants }) }),
        onSuccess: async () => {
            setUserId('');
            await client.invalidateQueries({ queryKey: ['grants', id] });
        },
    });
    return (
        <div className="access-editor">
            <p className="muted">
                Выберите участника и разрешённые действия. Чтение включается при предоставлении доступа.
            </p>
            <ErrorMessage error={query.error || participants.error || update.error} />
            {query.data?.data.map((g) => (
                <div className="grant-row" key={g.user_id}>
                    <span>{participants.data?.data.find((p) => p.id === g.user_id)?.name ?? 'Участник'}</span>
                    <small>
                        {['Чтение', g.comment && 'Комментарии', g.edit && 'Редактирование', g.export && 'Экспорт']
                            .filter(Boolean)
                            .join(' · ')}
                    </small>
                    <Button
                        variant="ghost"
                        size="small"
                        onClick={() =>
                            update.mutate((query.data?.data ?? []).filter((row) => row.user_id !== g.user_id))
                        }
                    >
                        Отозвать
                    </Button>
                </div>
            ))}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    update.mutate([
                        ...(query.data?.data ?? []).filter((g) => g.user_id !== Number(userId)),
                        { user_id: Number(userId), read: true, ...rights },
                    ]);
                }}
            >
                <label>
                    Участник
                    <Select
                        label="Участник"
                        value={userId}
                        onValueChange={(value) => {
                            setUserId(value);
                            setRights({ comment: false, edit: false, export: false });
                        }}
                        options={(participants.data?.data ?? []).map((p) => ({
                            value: String(p.id),
                            label: p.name,
                        }))}
                    />
                </label>
                <div className="checkbox-row">
                    {(['comment', 'edit', 'export'] as const).map((right) => (
                        <label key={right}>
                            <input
                                type="checkbox"
                                checked={rights[right]}
                                onChange={(e) => setRights({ ...rights, [right]: e.target.checked })}
                            />
                            {{ comment: 'Комментарии', edit: 'Редактирование', export: 'Экспорт' }[right]}
                        </label>
                    ))}
                </div>
                <Button type="submit" disabled={update.isPending || !userId}>
                    Предоставить доступ
                </Button>
            </form>
        </div>
    );
};
