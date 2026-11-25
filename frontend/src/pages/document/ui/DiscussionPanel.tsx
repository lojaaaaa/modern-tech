import { queryKeys } from '@/shared/api/query-keys';
import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, MoreHorizontal, Send, Trash2, X } from 'lucide-react';
import type { TextAnchor } from '@/features/document-reader';
import { api } from '@/shared/api/client';
import type { CommentRecord, Resource } from '@/shared/api/types';
import { Popover } from '@/shared/ui/popover';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatDate } from '@/shared/lib/utils';

export const DiscussionPanel = ({
    documentId,
    versionId,
    isCommentAllowed,
    comments,
    error,
    anchor,
    newCommentId,
    onCommentCreated,
    onCommentShown,
    onClearAnchor,
    onJump,
    onClose,
}: {
    documentId: string;
    versionId: string | undefined;
    isCommentAllowed: boolean;
    comments: CommentRecord[];
    error: unknown;
    anchor: TextAnchor | null;
    newCommentId: string | null;
    onCommentCreated: (id: string) => void;
    onCommentShown: () => void;
    onClearAnchor: () => void;
    onJump: (comment: CommentRecord) => void;
    onClose: () => void;
}) => {
    const client = useQueryClient();
    const count = comments.filter((comment) => !comment.deleted_at).length;
    const replies = new Map<string, CommentRecord[]>();
    for (const comment of comments) {
        if (!comment.parent_id) {
            continue;
        }
        const children = replies.get(comment.parent_id) ?? [];
        children.push(comment);
        replies.set(comment.parent_id, children);
    }
    const orderedComments = comments
        .filter((comment) => !comment.parent_id)
        .flatMap((comment) => [comment, ...(replies.get(comment.id) ?? [])]);
    const listRef = useRef<HTMLDivElement>(null);
    const newCommentRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const list = listRef.current;
        const comment = newCommentRef.current;
        if (!newCommentId || !list || !comment) {
            return;
        }
        const listRect = list.getBoundingClientRect();
        const commentRect = comment.getBoundingClientRect();
        if (commentRect.top < listRect.top || commentRect.height > listRect.height) {
            list.scrollTop += commentRect.top - listRect.top;
        } else if (commentRect.bottom > listRect.bottom) {
            list.scrollTop += commentRect.bottom - listRect.bottom;
        }
        onCommentShown();
    }, [comments, newCommentId, onCommentShown]);
    const remove = useMutation({
        mutationFn: (id: string) => api(`/comments/${id}`, { method: 'DELETE' }),
        onSuccess: () => client.invalidateQueries({ queryKey: [queryKeys.comments, documentId] }),
    });
    return (
        <aside className="content-panel comments-panel">
            <header className="discussion-heading">
                <h2>
                    <MessageSquare size={17} />
                    Обсуждение <span className="count-pill">{count}</span>
                </h2>
                <Button variant="ghost" size="icon" aria-label="Закрыть панель обсуждения" onClick={onClose}>
                    <X size={16} />
                </Button>
            </header>
            <ErrorMessage error={error || remove.error} />
            <div className="comment-list" ref={listRef}>
                {orderedComments.length ? (
                    orderedComments.map((c) => (
                        <article
                            key={c.id}
                            className={c.parent_id ? 'comment-reply' : undefined}
                            ref={c.id === newCommentId ? newCommentRef : null}
                        >
                            <div className="comment-meta">
                                <span className="avatar tiny">{c.author_name.slice(0, 1)}</span>
                                <strong>{c.author_name}</strong>
                                <small>{formatDate(c.created_at)}</small>
                                {c.can_delete && (
                                    <Popover
                                        align="end"
                                        label="Действия с комментарием"
                                        trigger={<MoreHorizontal size={16} />}
                                    >
                                        {(close) => (
                                            <Button
                                                variant="destructive"
                                                disabled={remove.isPending}
                                                onClick={() => {
                                                    close();
                                                    remove.mutate(c.id);
                                                }}
                                            >
                                                <Trash2 size={15} /> Удалить комментарий
                                            </Button>
                                        )}
                                    </Popover>
                                )}
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
                        </article>
                    ))
                ) : (
                    <div className="comment-empty">Комментариев пока нет</div>
                )}
            </div>
            {isCommentAllowed && versionId && (
                <CommentComposer
                    documentId={documentId}
                    versionId={versionId}
                    anchor={anchor}
                    onCommentCreated={onCommentCreated}
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
    onCommentCreated,
    onClearAnchor,
}: {
    documentId: string;
    versionId: string;
    anchor: TextAnchor | null;
    onCommentCreated: (id: string) => void;
    onClearAnchor: () => void;
}) => {
    const client = useQueryClient();
    const [comment, setComment] = useState('');
    const commentKey = useRef(crypto.randomUUID());
    const add = useMutation({
        mutationFn: () =>
            api<Resource<{ id: string }>>(`/documents/${documentId}/comments`, {
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
        onSuccess: async (result) => {
            commentKey.current = crypto.randomUUID();
            setComment('');
            onClearAnchor();
            onCommentCreated(result.data.id);
            await client.invalidateQueries({ queryKey: [queryKeys.comments, documentId] });
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
                    {add.isPending ? 'Отправляем…' : 'Добавить комментарий'}
                </Button>
            </form>
        </>
    );
};
