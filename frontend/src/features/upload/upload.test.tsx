import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UploadPanel } from './index';
import { Toast } from '@/shared/ui/toast';

afterEach(() => vi.unstubAllGlobals());

it('closes successful upload and announces processing without waiting for extraction', async () => {
    HTMLDialogElement.prototype.showModal = () => document.querySelector('dialog')?.setAttribute('open', '');
    HTMLDialogElement.prototype.close = vi.fn();
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ data: [] }))
    );
    const close = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <Toast />
            <UploadPanel onClose={close} />
        </QueryClientProvider>
    );
    fireEvent.change(screen.getByLabelText('Выбрать документы'), {
        target: { files: [new File(['test'], 'test.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('отправлены на проверку и обработку');
    client.clear();
});
