import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, X } from 'lucide-react';
import type { TextAnchor } from '@/features/document-reader';
import { api } from '@/shared/api/client';
import type { CommentRecord } from '@/shared/api/types';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatDate } from '@/shared/lib/utils';

export const DiscussionPanel = ({
    documentId,
    versionId,
    canComment,
    comments,
    error,
    anchor,
    onClearAnchor,
    onJump,
}: {
    documentId: string;
    versionId: string | undefined;
    canComment: boolean;
    comments: CommentRecord[];
    error: unknown;
    anchor: TextAnchor | null;
    onClearAnchor: () => void;
    onJump: (comment: CommentRecord) => void;
}) => {
    const client = useQueryClient();
    const [openOnly, setOpenOnly] = useState(false);
    const resolution = useMutation({
        mutationFn: (comment: CommentRecord) =>
            api(`/comments/${comment.id}/resolution`, {
                method: 'PUT',
                body: JSON.stringify({ resolved: !comment.resolved_at }),
            }),
        onSuccess: () => client.invalidateQueries({ queryKey: ['comments', documentId] }),
    });
    return (
        <aside className="content-panel comments-panel">
            <h2>
                <MessageSquare size={18} />
                Обсуждение<span className="count-pill">{comments.length ?? 0}</span>
            </h2>
            <ErrorMessage error={error} />
            <label className="discussion-filter">
                <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
                Только открытые
            </label>
            <ErrorMessage error={resolution.error} />
            <div className="comment-list">
                {comments.length ? (
                    comments
                        .filter((c) => !openOnly || !c.resolved_at)
                        .map((c) => (
                            <article key={c.id}>
                                <div className="comment-meta">
                                    <span className="avatar tiny">{c.author_name.slice(0, 1)}</span>
                                    <strong>{c.author_name}</strong>
                                    <small>{formatDate(c.created_at)}</small>
                                </div>
                                {c.anchor_quote && (
                                    <button
                                        className="comment-anchor"
                                        onClick={() => onJump(c)}
                                        title="Перейти к фрагменту"
                                    >
                                        {c.anchor_quote}
                                    </button>
                                )}
                                <p>{c.body}</p>
                                {c.resolved_at && <small className="muted">Обсуждение закрыто</small>}
                                {canComment && !c.deleted_at && (
                                    <Button
                                        variant="ghost"
                                        size="small"
                                        disabled={resolution.isPending}
                                        onClick={() => resolution.mutate(c)}
                                    >
                                        {c.resolved_at ? 'Открыть снова' : 'Закрыть обсуждение'}
                                    </Button>
                                )}
                            </article>
                        ))
                ) : (
                    <div className="comment-empty">Нет комментариев</div>
                )}
            </div>
            {canComment && versionId && (
                <CommentComposer
                    documentId={documentId}
                    versionId={versionId}
                    anchor={anchor}
                    onClearAnchor={onClearAnchor}
                />
            )}
        </aside>
    );
};

const CommentComposer = ({
    documentId,
    versionId,
    anchor,
    onClearAnchor,
}: {
    documentId: string;
    versionId: string;
    anchor: TextAnchor | null;
    onClearAnchor: () => void;
}) => {
    const client = useQueryClient();
    const [comment, setComment] = useState('');
    const commentKey = useRef(crypto.randomUUID());
    const add = useMutation({
        mutationFn: () =>
            api(`/documents/${documentId}/comments`, {
                method: 'POST',
                headers: { 'Idempotency-Key': commentKey.current },
                body: JSON.stringify({
                    body: comment,
                    version_id: versionId,
                    ...(anchor
                        ? {
                              anchor_start: anchor.start,
                              anchor_end: anchor.end,
                              anchor_quote: anchor.quote,
                          }
                        : {}),
                }),
            }),
        onSuccess: async () => {
            commentKey.current = crypto.randomUUID();
            setComment('');
            onClearAnchor();
            await client.invalidateQueries({ queryKey: ['comments', documentId] });
        },
    });
    return (
        <>
            <ErrorMessage error={add.error} />{' '}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    add.mutate();
                }}
            >
                {anchor && (
                    <div className="comment-draft-anchor">
                        <span>{anchor.quote}</span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Убрать привязку к тексту"
                            onClick={() => onClearAnchor()}
                        >
                            <X size={14} />
                        </Button>
                    </div>
                )}
                <textarea
                    aria-label="Текст комментария"
                    placeholder="Напишите комментарий…"
                    maxLength={5000}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                />
                <Button disabled={!comment.trim() || add.isPending} type="submit">
                    <Send size={15} />
                    Отправить
                </Button>
            </form>
        </>
    );
};
