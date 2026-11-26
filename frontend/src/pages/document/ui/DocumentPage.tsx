import { useDocumentWorkspace } from '../model/useDocumentWorkspace';
import { FilePreview } from '@/features/document-reader';
import type { DocumentSearchMatch } from '@/shared/api/types';
import { AlertDialog } from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Modal } from '@/shared/ui/modal';
import { PageLoader } from '@/shared/ui/spinner';
import { lazy, Suspense } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { AccessEditor } from './AccessEditor';
import { DiscussionPanel } from './DiscussionPanel';
import { DocumentHeading } from './DocumentHeading';
import { DocumentToolbar } from './DocumentToolbar';
import { DocumentVersions } from './DocumentVersions';
import { OfficeEditor } from './OfficeEditor';

const VersionCompare = lazy(() =>
    import('@/features/version-compare').then((module) => ({ default: module.VersionCompare }))
);

export const DocumentPage = () => {
    const { id } = useParams();
    const location = useLocation();

    return (
        <DocumentWorkspace
            key={`${id}:${location.state?.searchMatch?.version_id ?? ''}:${location.state?.searchMatch?.start ?? ''}`}
            searchMatch={location.state?.searchMatch}
        />
    );
};

export const DocumentWorkspace = ({ searchMatch }: { searchMatch?: DocumentSearchMatch }) => {
    const {
        id,
        isDeleteConfirmationOpen,
        setConfirmDelete,
        isPublishOpen,
        setPublishOpen,
        publicationKeyRef,
        isDiscussionOpen,
        setDiscussionOpen,
        tab,
        setTab,
        isDiscussionVisible,
        anchor,
        setAnchor,
        setTarget,
        newCommentId,
        setNewCommentId,
        selectedVersion,
        setSelectedVersion,
        isExpanded,
        setExpanded,
        fileInput,
        doc,
        d,
        activeVersionId,
        versions,
        publishDraft,
        activeVersion,
        isImage,
        text,
        comments,
        remove,
        version,
        jumpToComment,
        reader,
    } = useDocumentWorkspace({ searchMatch });

    return (
        <>
            {isPublishOpen && (
                <Modal
                    titleId="publish-draft-title"
                    onClose={() => setPublishOpen(false)}
                    isBusy={publishDraft.isPending}
                >
                    <h2 id="publish-draft-title">Добавить новую версию</h2>
                    <p className="muted">
                        Актуальное содержимое редактора будет добавлено в историю версий. Обычное сохранение историю не
                        меняет.
                    </p>
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
                    <DocumentHeading
                        id={id}
                        setConfirmDelete={setConfirmDelete}
                        d={d}
                        versions={versions}
                        version={version}
                    />
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
                        className={`detail-grid document-layout ${isExpanded ? 'is-expanded' : ''} ${isDiscussionOpen && isDiscussionVisible ? 'discussion-open' : ''}`}
                    >
                        <section
                            className={`content-panel reader-panel ${tab === 'preview' ? 'preview-panel' : ''}`}
                            style={
                                tab === 'editor'
                                    ? { gridColumn: '1 / -1' }
                                    : tab === 'versions'
                                      ? { height: 'auto', alignSelf: 'start' }
                                      : undefined
                            }
                        >
                            <DocumentToolbar
                                isDiscussionOpen={isDiscussionOpen}
                                setDiscussionOpen={setDiscussionOpen}
                                tab={tab}
                                setTab={setTab}
                                isDiscussionVisible={isDiscussionVisible}
                                setSelectedVersion={setSelectedVersion}
                                isExpanded={isExpanded}
                                setExpanded={setExpanded}
                                d={d}
                                versions={versions}
                                selectedVersion={selectedVersion}
                                isImage={isImage}
                                text={text}
                                version={version}
                            />
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
                            <div className="document-preview-pane" hidden={tab !== 'preview'}>
                                {activeVersionId &&
                                    (activeVersion?.status === 'ready' ? (
                                        <FilePreview
                                            key={activeVersionId}
                                            versionId={activeVersionId}
                                            fallback={reader}
                                        />
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
                            </div>
                            {tab === 'editor' && (
                                <>
                                    <div className="editor-savebar">
                                        <span>Сохранение в редакторе не добавляет запись в историю.</span>
                                        {d.permissions.manage && (
                                            <Button
                                                size="small"
                                                disabled={publishDraft.isPending}
                                                onClick={() => {
                                                    publishDraft.reset();
                                                    publicationKeyRef.current = crypto.randomUUID();
                                                    setPublishOpen(true);
                                                }}
                                            >
                                                Добавить новую версию
                                            </Button>
                                        )}
                                    </div>
                                    <OfficeEditor documentId={d.id} />
                                </>
                            )}
                            {tab === 'text' && reader}
                            {tab === 'compare' && (
                                <>
                                    <div className="compare-breadcrumb">
                                        <button type="button" onClick={() => setTab('versions')}>
                                            ← Все версии
                                        </button>
                                        <span>/ Сравнение</span>
                                    </div>
                                    <Suspense fallback={<PageLoader />}>
                                        <VersionCompare
                                            versions={
                                                versions.data?.data.filter((item) => item.status === 'ready') ?? []
                                            }
                                        />
                                    </Suspense>
                                </>
                            )}
                            {tab === 'versions' && (
                                <DocumentVersions
                                    id={id}
                                    setPublishOpen={setPublishOpen}
                                    publicationKeyRef={publicationKeyRef}
                                    setTab={setTab}
                                    setAnchor={setAnchor}
                                    setTarget={setTarget}
                                    setSelectedVersion={setSelectedVersion}
                                    fileInput={fileInput}
                                    d={d}
                                    versions={versions}
                                    publishDraft={publishDraft}
                                    version={version}
                                />
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
