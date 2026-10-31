import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocumentPage } from './ui/DocumentPage';

const previewRender = vi.hoisted(() => vi.fn());
vi.mock('@/features/document-reader', () => ({
    FilePreview: () => {
        previewRender();
        return <div>Просмотр изображения</div>;
    },
    TextReader: () => <div>Текст</div>,
}));
afterEach(() => {
    vi.unstubAllGlobals();
    previewRender.mockClear();
});
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
    await screen.findByText('Нет комментариев');
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole('button', { name: 'Извлечённые данные' })).not.toBeInTheDocument();
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
