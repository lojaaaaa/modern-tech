import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocumentPage } from './ui/DocumentPage';
import type * as DocumentReader from '@/features/document-reader';

const previewRender = vi.hoisted(() => vi.fn());
vi.mock('@/features/document-reader', async (importOriginal) => ({
    ...(await importOriginal<typeof DocumentReader>()),
    FilePreview: ({ versionId }: { versionId: string }) => {
        previewRender();
        return (
            <div>
                Просмотр изображения<span data-testid="preview-version">{versionId}</span>
            </div>
        );
    },
}));
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    previewRender.mockClear();
});

it('opens the selected ready version and returns to the current one', async () => {
    const v1 = {
        id: 'v1',
        number: 1,
        mime: 'application/pdf',
        status: 'ready',
        size: 1024,
        original_name: 'first.pdf',
    };
    const v2 = { ...v1, id: 'v2', number: 2, original_name: 'second.pdf' };
    const pending = { ...v1, id: 'v3', number: 3, status: 'scanning' };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url === '/api/v1/documents/image-1')
                return Response.json({
                    data: {
                        id: 'image-1',
                        title: 'Договор',
                        owner: { id: 1, name: 'Автор' },
                        updated_at: '2026-10-31T10:00:00Z',
                        processing_status: 'ready',
                        permissions: { comment: true, edit: true, export: true, manage: true },
                        version: v2,
                    },
                });
            if (url.endsWith('/versions')) return Response.json({ data: [pending, v2, v1] });
            if (url.endsWith('/comments')) return Response.json({ data: [] });
            throw new Error('Unexpected request: ' + url);
        })
    );
    renderDocument();
    expect(await screen.findByTestId('preview-version')).toHaveTextContent('v2');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Версии' }));
    expect(await screen.findByRole('button', { name: 'Открыть версию 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть версию 3' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Открыть версию 1' }));
    expect(await screen.findByTestId('preview-version')).toHaveTextContent('v1');
    await user.click(screen.getByRole('button', { name: 'Текущая версия' }));
    expect(await screen.findByTestId('preview-version')).toHaveTextContent('v2');
});

it('does not offer historical version preview without edit permission', async () => {
    const current = {
        id: 'v2',
        number: 2,
        mime: 'application/pdf',
        status: 'ready',
        size: 1024,
        original_name: 'current.pdf',
    };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url === '/api/v1/documents/image-1')
                return Response.json({
                    data: {
                        id: 'image-1',
                        title: 'Договор',
                        owner: { id: 1, name: 'Автор' },
                        updated_at: '2026-10-31T10:00:00Z',
                        processing_status: 'ready',
                        permissions: { comment: false, edit: false, export: false, manage: false },
                        version: current,
                    },
                });
            if (url.endsWith('/versions'))
                return Response.json({ data: [current, { ...current, id: 'v1', number: 1 }] });
            throw new Error('Unexpected request: ' + url);
        })
    );
    renderDocument();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Версии' }));
    expect(await screen.findByRole('button', { name: 'Открыть версию 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть версию 1' })).not.toBeInTheDocument();
});

const mockOverflowingComments = (list: HTMLElement) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 150, 300, 70));
    Object.defineProperty(list, 'getBoundingClientRect', {
        configurable: true,
        value: () => new DOMRect(0, 0, 300, 100),
    });
};

const existingComments = [1, 2].map((number) => ({
    id: `old-${number}`,
    author_id: 1,
    author_name: 'Автор',
    body: `Существующий комментарий ${number}`,
    version_id: 'v1',
    created_at: '2026-10-31T10:00:00Z',
    anchor_quote: null,
    resolved_at: null,
    deleted_at: null,
}));
const renderDocument = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/documents/image-1']}>
                <Routes>
                    <Route path="/documents/:id" element={<DocumentPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
    return { ...view, queryClient };
};
it('hides image entities, loads history on demand and isolates comment typing from preview', async () => {
    const fetcher = vi.fn(async (url: string) => {
        if (url === '/api/v1/documents/image-1') {
            return Response.json({
                data: {
                    id: 'image-1',
                    title: 'Фото.png',
                    owner: { id: 1, name: 'Автор' },
                    updated_at: '2026-10-31T10:00:00Z',
                    processing_status: 'ready',
                    permissions: { comment: true, edit: false, export: false, manage: false },
                    version: {
                        id: 'v1',
                        number: 1,
                        mime: 'image/png',
                        status: 'ready',
                        size: 1024,
                        original_name: 'Фото.png',
                    },
                },
            });
        }
        if (url.endsWith('/comments') || url.endsWith('/versions')) {
            return Response.json({ data: [] });
        }
        throw new Error('Unexpected request: ' + url);
    });
    vi.stubGlobal('fetch', fetcher);
    const view = renderDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Обсуждение' }));
    await screen.findByText('Комментариев пока нет');
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole('button', { name: 'Даты, суммы и организации' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/entities') || url.endsWith('/versions'))).toBe(false);
    const renders = previewRender.mock.calls.length;
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Текст комментария'), 'Новый комментарий');
    expect(previewRender).toHaveBeenCalledTimes(renders);
    await user.click(screen.getByRole('button', { name: 'Версии' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/versions'))).toBe(true));
});
it('aborts an unfinished document request when leaving the page', async () => {
    let requestSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) => {
            requestSignal = init.signal;
            return new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        })
    );
    const view = renderDocument();
    await waitFor(() => expect(requestSignal).toBeDefined());
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);
});

it('brings a new comment into view in an overflowing discussion', async () => {
    let saved = false;
    const comment = {
        id: 'comment-1',
        author_id: 1,
        author_name: 'Автор',
        body: 'Новый комментарий',
        version_id: 'v1',
        created_at: '2026-10-31T10:00:00Z',
        anchor_quote: null,
        resolved_at: null,
        deleted_at: null,
    };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            if (url === '/api/v1/documents/image-1') {
                return Response.json({
                    data: {
                        id: 'image-1',
                        title: 'Фото.png',
                        owner: { id: 1, name: 'Автор' },
                        updated_at: '2026-10-31T10:00:00Z',
                        processing_status: 'ready',
                        permissions: { comment: true, edit: false, export: false, manage: false },
                        version: {
                            id: 'v1',
                            number: 1,
                            mime: 'image/png',
                            status: 'ready',
                            size: 1024,
                            original_name: 'Фото.png',
                        },
                    },
                });
            }
            if (url.endsWith('/comments')) {
                if (init?.method === 'POST') {
                    saved = true;
                    return Response.json({ data: comment }, { status: 201 });
                }
                return Response.json({ data: saved ? [...existingComments, comment] : existingComments });
            }
            throw new Error('Unexpected request: ' + url);
        })
    );
    renderDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Обсуждение' }));
    await screen.findByText('Существующий комментарий 2');
    const list = document.querySelector<HTMLElement>('.comment-list')!;
    mockOverflowingComments(list);
    expect(list.scrollTop).toBe(0);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Текст комментария'), comment.body);
    await user.click(screen.getByRole('button', { name: 'Добавить комментарий' }));
    expect(await screen.findByText(comment.body)).toBeInTheDocument();
    await waitFor(() => expect(list.scrollTop).toBe(120));
});

it('brings a comment on selected text into view in an overflowing discussion', async () => {
    let saved = false;
    const comment = {
        id: 'comment-1',
        author_id: 1,
        author_name: 'Автор',
        body: 'Комментарий к фрагменту',
        version_id: 'v1',
        created_at: '2026-10-31T10:00:00Z',
        anchor_start: 0,
        anchor_end: 6,
        anchor_quote: 'Важный',
        resolved_at: null,
        deleted_at: null,
    };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            if (url === '/api/v1/documents/image-1') {
                return Response.json({
                    data: {
                        id: 'image-1',
                        title: 'Документ.txt',
                        owner: { id: 1, name: 'Автор' },
                        updated_at: '2026-10-31T10:00:00Z',
                        processing_status: 'ready',
                        permissions: { comment: true, edit: false, export: false, manage: false },
                        version: {
                            id: 'v1',
                            number: 1,
                            mime: 'text/plain',
                            status: 'ready',
                            size: 1024,
                            original_name: 'Документ.txt',
                        },
                    },
                });
            }
            if (url === '/api/v1/versions/v1/text') {
                return Response.json({ data: { text: 'Важный фрагмент', status: 'ready' } });
            }
            if (url.endsWith('/comments')) {
                if (init?.method === 'POST') {
                    saved = true;
                    return Response.json({ data: comment }, { status: 201 });
                }
                return Response.json({ data: saved ? [...existingComments, comment] : existingComments });
            }
            throw new Error('Unexpected request: ' + url);
        })
    );
    renderDocument();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Обсуждение' }));
    await screen.findByText('Существующий комментарий 2');
    const list = document.querySelector<HTMLElement>('.comment-list')!;
    mockOverflowingComments(list);
    expect(list.scrollTop).toBe(0);
    await user.click(await screen.findByRole('button', { name: 'Текст' }));
    const content = await screen.findByText('Важный фрагмент');
    const range = document.createRange();
    range.setStart(content.firstChild!, 0);
    range.setEnd(content.firstChild!, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(content);
    await user.click(screen.getByRole('button', { name: 'Комментировать выделение' }));
    await user.type(screen.getByLabelText('Комментарий к выделению'), comment.body);
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText(comment.body)).toBeInTheDocument();
    await waitFor(() => expect(list.scrollTop).toBe(120));
});
