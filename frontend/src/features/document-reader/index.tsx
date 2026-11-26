import { Spinner } from '@/shared/ui/spinner';
import { queryKeys } from '@/shared/api/query-keys';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Send, MessageSquarePlus, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { api } from '@/shared/api/client';
import type { CommentRecord, Resource } from '@/shared/api/types';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import './file-preview.css';
import { PdfPreview } from './PdfPreview';
import { StructuredPreview } from './StructuredPreview';

export interface TextAnchor {
    start: number;
    end: number;
    quote: string;
}
export interface AnchorTarget extends TextAnchor {
    key: string;
}
export const TextReader = ({
    text,
    isCommentAllowed,
    target,
    searchTarget,
    onDismissSearch,
    onComment,
    onSubmitComment,
    activeComment,
    comments = [],
    onSelectComment,
}: {
    text: string;
    isCommentAllowed: boolean;
    target: AnchorTarget | null;
    searchTarget?: TextAnchor | null;
    onDismissSearch?: () => void;
    activeComment?: CommentRecord | null;
    comments?: CommentRecord[];
    onSelectComment?: (comment: CommentRecord) => void;
    onComment: (anchor: TextAnchor) => void;
    onSubmitComment?: (anchor: TextAnchor, body: string) => Promise<void>;
}) => {
    const [isHovered, setHovered] = useState(false);
    const [isComposing, setComposing] = useState(false);
    const [body, setBody] = useState('');
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [position, setPosition] = useState({ left: 20, top: 20 });
    const root = useRef<HTMLDivElement>(null);
    const [selection, setSelection] = useState<TextAnchor | null>(null);
    useEffect(() => {
        if (searchTarget) {
            root.current?.querySelector('[data-search-match]')?.scrollIntoView?.({ block: 'center' });
        }
    }, [searchTarget, text]);
    useEffect(() => {
        if (!target || text.slice(target.start, target.end) !== target.quote) {
            return;
        }
        const mark = root.current?.querySelector('mark[data-selected="true"]');
        mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (mark instanceof HTMLElement) {
            mark.focus({ preventScroll: true });
        }
    }, [target, text]);

    const capture = () => {
        const selected = window.getSelection();
        if (!isCommentAllowed || !selected?.rangeCount || !root.current || selected.isCollapsed) {
            setSelection(null);

            return;
        }
        const range = selected.getRangeAt(0);
        if (!root.current.contains(range.startContainer) || !root.current.contains(range.endContainer)) {
            setSelection(null);

            return;
        }

        const rect =
            typeof range.getBoundingClientRect === 'function'
                ? range.getBoundingClientRect()
                : { left: 20, bottom: 20 };

        const container = root.current.parentElement?.getBoundingClientRect();
        if (container) {
            setPosition({
                left: Math.max(8, Math.min(rect.left - container.left, container.width - 320)),
                top: Math.max(8, Math.min(rect.bottom - container.top + 8, container.height - 240)),
            });
        }
        const prefix = range.cloneRange();
        prefix.selectNodeContents(root.current);
        prefix.setEnd(range.startContainer, range.startOffset);
        const start = prefix.toString().length;
        const quote = range.toString();
        setSelection(quote.trim() && quote.length <= 2000 ? { start, end: start + quote.length, quote } : null);
    };

    const isValid = target && text.slice(target.start, target.end) === target.quote;

    const renderText = (start: number, end: number) => {
        if (!searchTarget || searchTarget.start >= end || searchTarget.end <= start) {
            return text.slice(start, end);
        }
        const matchStart = Math.max(start, searchTarget.start);
        const matchEnd = Math.min(end, searchTarget.end);

        return (
            <>
                {text.slice(start, matchStart)}
                <mark className="search-mark" data-search-match>
                    {text.slice(matchStart, matchEnd)}
                </mark>
                {text.slice(matchEnd, end)}
            </>
        );
    };

    return (
        <div className="text-reader">
            {target && !isValid && (
                <p role="status" className="muted">
                    Фрагмент не найден в тексте этой версии. Комментарий сохранён в обсуждении.
                </p>
            )}
            {activeComment && isHovered && (
                <aside
                    className="annotation-card"
                    onMouseEnter={() => setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                >
                    <header>
                        <span className="avatar tiny">{activeComment.author_name.slice(0, 1)}</span>
                        <strong>{activeComment.author_name}</strong>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Закрыть комментарий"
                            onClick={() => {
                                setHovered(false);
                            }}
                        >
                            <X size={14} />
                        </Button>
                    </header>
                    <p>{activeComment.body}</p>
                </aside>
            )}
            {selection && (
                <div className="selection-composer" style={position}>
                    {isComposing && onSubmitComment ? (
                        <form
                            onSubmit={async (e) => {
                                e.preventDefault();
                                setBusy(true);
                                setError(null);
                                try {
                                    await onSubmitComment(selection, body);
                                    setBody('');
                                    setSelection(null);
                                    setComposing(false);
                                } catch (error) {
                                    setError(error);
                                } finally {
                                    setBusy(false);
                                }
                            }}
                        >
                            <textarea
                                autoFocus
                                aria-label="Комментарий к выделению"
                                placeholder="Комментарий…"
                                maxLength={5000}
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                            />
                            <ErrorMessage error={error} />
                            <div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="small"
                                    disabled={isBusy}
                                    onClick={() => {
                                        setSelection(null);
                                        setComposing(false);
                                    }}
                                >
                                    Отмена
                                </Button>
                                <Button size="small" disabled={isBusy || !body.trim()}>
                                    <Send size={14} />
                                    Отправить
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <Button
                            size="small"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                if (onSubmitComment) {
                                    setComposing(true);
                                } else {
                                    onComment(selection);
                                    setSelection(null);
                                }
                            }}
                        >
                            <MessageSquarePlus size={16} />
                            Комментировать выделение
                        </Button>
                    )}
                    {!isComposing && (
                        <Button variant="ghost" size="icon" aria-label="Закрыть" onClick={() => setSelection(null)}>
                            <X size={14} />
                        </Button>
                    )}
                </div>
            )}
            <div
                ref={root}
                className="selectable-text"
                onClick={onDismissSearch}
                onMouseUp={capture}
                onKeyUp={capture}
                onTouchEnd={capture}
            >
                {(() => {
                    const anchors = comments
                        .filter(
                            (comment) =>
                                !comment.deleted_at &&
                                comment.anchor_start !== null &&
                                comment.anchor_end !== null &&
                                !!comment.anchor_quote &&
                                text.slice(comment.anchor_start, comment.anchor_end) === comment.anchor_quote
                        )
                        .sort((a, b) => (a.anchor_start ?? 0) - (b.anchor_start ?? 0));

                    if (isValid && !anchors.some((comment) => comment.id === target.key)) {
                        anchors.push({
                            id: target.key,
                            anchor_start: target.start,
                            anchor_end: target.end,
                            anchor_quote: target.quote,
                            author_name: activeComment?.author_name ?? 'участника',
                        } as CommentRecord);
                        anchors.sort((a, b) => (a.anchor_start ?? 0) - (b.anchor_start ?? 0));
                    }
                    const bounds = new Map<number, { opens: CommentRecord[]; closes: string[] }>();

                    const boundary = (offset: number) => {
                        const current = bounds.get(offset) ?? { opens: [], closes: [] };
                        bounds.set(offset, current);

                        return current;
                    };

                    boundary(0);
                    boundary(text.length);
                    for (const comment of anchors) {
                        const start = comment.anchor_start!;
                        const end = comment.anchor_end!;
                        if (start >= 0 && end > start && end <= text.length) {
                            boundary(start).opens.push(comment);
                            boundary(end).closes.push(comment.id);
                        }
                    }
                    const active = new Map<string, CommentRecord>();
                    const focused = new Set<string>();
                    const edges = [...bounds].sort(([left], [right]) => left - right);

                    return edges.slice(0, -1).map(([start, { opens, closes }], index) => {
                        closes.forEach((id) => active.delete(id));
                        opens.forEach((comment) => active.set(comment.id, comment));
                        const end = edges[index + 1]![0];
                        const comment = (target && active.get(target.key)) || active.values().next().value;
                        if (!comment) {
                            return <span key={start}>{renderText(start, end)}</span>;
                        }
                        const isFocusable = !focused.has(comment.id);
                        focused.add(comment.id);

                        return (
                            <mark
                                key={start}
                                className={`comment-mark ${target?.key === comment.id ? 'comment-mark-selected' : ''}`}
                                data-selected={target?.key === comment.id ? 'true' : undefined}
                                tabIndex={isFocusable ? 0 : -1}
                                role="button"
                                aria-label={`Открыть комментарий ${comment.author_name}`}
                                onClick={() => onSelectComment?.(comment)}
                                onMouseEnter={() => {
                                    if (target?.key === comment.id) {
                                        setHovered(true);
                                    }
                                }}
                                onMouseLeave={() => setHovered(false)}
                                onFocus={() => {
                                    if (target?.key === comment.id) {
                                        setHovered(true);
                                    }
                                }}
                                onBlur={() => setHovered(false)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        onSelectComment?.(comment);
                                    }
                                }}
                            >
                                {renderText(start, end)}
                            </mark>
                        );
                    });
                })()}
            </div>
        </div>
    );
};
export const FilePreview = ({ versionId, fallback }: { versionId: string; fallback: React.ReactNode }) => {
    const [zoom, setZoom] = useState(1);

    const query = useQuery({
        queryKey: [queryKeys.preview, versionId],
        queryFn: ({ signal }) =>
            api<Resource<{ kind: 'image' | 'pdf' | 'text' | 'markdown' | 'csv' | 'spreadsheet'; status: string }>>(
                `/versions/${versionId}/preview?status=1`,
                { signal }
            ),
        refetchInterval: (q) => (q.state.data?.data.status === 'pending' ? 2500 : false),
    });

    const preview = query.data?.data;
    if (query.error) {
        return <ErrorMessage error={query.error} />;
    }
    if (query.isPending || preview?.status === 'pending') {
        return (
            <div className="empty-state" role="status">
                <Spinner />
                Готовим предпросмотр…
            </div>
        );
    }
    if (preview?.status === 'failed') {
        return <div className="empty-state">Предпросмотр недоступен. Откройте вкладку «Текст документа».</div>;
    }
    const url = `/api/v1/versions/${versionId}/preview`;
    if (preview && ['markdown', 'csv', 'spreadsheet'].includes(preview.kind)) {
        return <StructuredPreview versionId={versionId} kind={preview.kind as 'markdown' | 'csv' | 'spreadsheet'} />;
    }
    if (preview?.kind === 'text') {
        return fallback;
    }
    if (preview?.kind === 'image') {
        return (
            <div className="image-reader">
                <div className="reader-action-bar">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Уменьшить"
                        disabled={zoom <= 0.25}
                        onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                    >
                        <ZoomOut size={18} />
                    </Button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Увеличить"
                        disabled={zoom >= 3}
                        onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                    >
                        <ZoomIn size={18} />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Сбросить масштаб" onClick={() => setZoom(1)}>
                        <RotateCcw size={16} />
                    </Button>
                </div>
                <div className="image-canvas">
                    <img
                        src={url}
                        alt="Предпросмотр документа"
                        style={
                            zoom === 1
                                ? { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }
                                : { width: `${zoom * 100}%`, maxWidth: 'none' }
                        }
                    />
                </div>
            </div>
        );
    }

    return <PdfPreview key={versionId} url={url} />;
};
