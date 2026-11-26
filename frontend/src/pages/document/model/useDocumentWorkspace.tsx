import { TextReader, type AnchorTarget, type TextAnchor } from '@/features/document-reader';
import { api } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';
import type { CommentRecord, DocumentRecord, DocumentSearchMatch, Resource, Version } from '@/shared/api/types';
import { ErrorMessage } from '@/shared/ui/error-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

type HistoryVersion = Version & { created_at?: string; creator_name?: string };
export const useDocumentWorkspace = ({ searchMatch }: { searchMatch?: DocumentSearchMatch | undefined }) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const client = useQueryClient();
    const [isDeleteConfirmationOpen, setConfirmDelete] = useState(false);
    const [isPublishOpen, setPublishOpen] = useState(false);
    const publicationKeyRef = useRef('');
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
    const [isExpanded, setExpanded] = useState(false);
    useEffect(() => {
        if (!isExpanded) {
            return;
        }
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setExpanded(false);
            }
        };

        document.addEventListener('keydown', onKey);

        return () => {
            document.body.style.overflow = previous;
            document.removeEventListener('keydown', onKey);
        };
    }, [isExpanded]);
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

    const publishDraft = useMutation({
        mutationFn: () =>
            api(`/documents/${id}/draft/publication`, {
                method: 'POST',
                headers: { 'Idempotency-Key': publicationKeyRef.current },
            }),
        onSuccess: async () => {
            setPublishOpen(false);
            setSelectedVersion(null);
            setTab('versions');
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
        enabled:
            !!activeVersionId && activeVersionId === d?.version?.id && !isImage && activeVersion?.status === 'ready',
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

    return {
        id,
        navigate,
        client,
        isDeleteConfirmationOpen,
        setConfirmDelete,
        isPublishOpen,
        setPublishOpen,
        publicationKeyRef,
        isDiscussionOpen,
        setDiscussionOpen,
        tab,
        setTab,
        isSearchDismissed,
        setSearchDismissed,
        isDiscussionVisible,
        anchor,
        setAnchor,
        target,
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
        extractedText,
        searchTarget,
        entities,
        comments,
        remove,
        version,
        chooseAnchor,
        jumpToComment,
        reader,
        searchMatch,
    };
};
