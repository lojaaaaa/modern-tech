import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Send, MessageSquarePlus, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { api } from '@/shared/api/client';
import type { CommentRecord, Resource } from '@/shared/api/types';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
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
    canComment,
    target,
    onComment,
    onSubmitComment,
    activeComment,
}: {
    text: string;
    canComment: boolean;
    target: AnchorTarget | null;
    activeComment?: CommentRecord | null;
    onComment: (anchor: TextAnchor) => void;
    onSubmitComment?: (anchor: TextAnchor, body: string) => Promise<void>;
}) => {
    const [hovered, setHovered] = useState(false);
    const [composing, setComposing] = useState(false);
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [position, setPosition] = useState({ left: 20, top: 20 });
    const root = useRef<HTMLDivElement>(null);
    const [selection, setSelection] = useState<TextAnchor | null>(null);
    useEffect(() => {
        if (!target || text.slice(target.start, target.end) !== target.quote) {
            return;
        }
        const mark = root.current?.querySelector('mark');
        mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (mark instanceof HTMLElement) {
            mark.focus({ preventScroll: true });
        }
    }, [target, text]);
    const capture = () => {
        const selected = window.getSelection();
        if (!canComment || !selected?.rangeCount || !root.current || selected.isCollapsed) {
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
    const valid = target && text.slice(target.start, target.end) === target.quote;
    return (
        <div className="text-reader">
            {target && !valid && (
                <p role="status" className="muted">
                    Фрагмент не найден в тексте этой версии. Комментарий сохранён в обсуждении.
                </p>
            )}
            {activeComment && hovered && (
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
                    {composing && onSubmitComment ? (
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
                                    disabled={busy}
                                    onClick={() => {
                                        setSelection(null);
                                        setComposing(false);
                                    }}
                                >
                                    Отмена
                                </Button>
                                <Button size="small" disabled={busy || !body.trim()}>
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
                    {!composing && (
                        <Button variant="ghost" size="icon" aria-label="Закрыть" onClick={() => setSelection(null)}>
                            <X size={14} />
                        </Button>
                    )}
                </div>
            )}
            <div ref={root} className="selectable-text" onMouseUp={capture} onKeyUp={capture} onTouchEnd={capture}>
                {valid ? (
                    <>
                        {text.slice(0, target.start)}
                        <mark
                            tabIndex={0}
                            className="comment-mark"
                            onMouseEnter={() => setHovered(true)}
                            onMouseLeave={() => setHovered(false)}
                            onFocus={() => setHovered(true)}
                            onBlur={() => setHovered(false)}
                        >
                            {text.slice(target.start, target.end)}
                        </mark>
                        {text.slice(target.end)}
                    </>
                ) : (
                    text
                )}
            </div>
        </div>
    );
};
export const FilePreview = ({ versionId, fallback }: { versionId: string; fallback: React.ReactNode }) => {
    const [zoom, setZoom] = useState(1);
    const query = useQuery({
        queryKey: ['preview', versionId],
        queryFn: ({ signal }) =>
            api<Resource<{ kind: 'image' | 'pdf' | 'text'; status: string }>>(
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
                <div className="loading-orbit" />
                Готовим предпросмотр…
            </div>
        );
    }
    if (preview?.status === 'failed') {
        return <div className="empty-state">Предпросмотр недоступен. Откройте вкладку «Текст».</div>;
    }
    const url = `/api/v1/versions/${versionId}/preview`;
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
    return <iframe className="pdf-reader" title="Предпросмотр PDF" src={`${url}#view=FitH`} />;
};
