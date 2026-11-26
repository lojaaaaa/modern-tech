import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccessEditor } from './AccessEditor';

afterEach(() => vi.unstubAllGlobals());

it('keeps employee permissions clickable after asynchronous selection and sends the chosen grants', async () => {
    HTMLDialogElement.prototype.showModal = () => {
        document.querySelectorAll('dialog').forEach((dialog) => dialog.setAttribute('open', ''));
    };
    HTMLDialogElement.prototype.close = vi.fn();
    let saved: unknown;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            if (init?.method === 'PUT') {
                saved = JSON.parse(String(init.body));

                return Response.json({ data: [], meta: { revision: 1 } });
            }
            if (url.includes('/participants')) {
                return Response.json({
                    data: [{ id: 2, name: 'Антон Морозов', email: 'anton@example.test', role: 'employee' }],
                });
            }

            return Response.json({ data: [], meta: { revision: 1 } });
        })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <AccessEditor id="doc" owner={{ id: 1, name: 'Владелец', email: 'owner@example.test' }} />
        </QueryClientProvider>
    );
    const open = screen.getByRole('button', { name: 'Предоставить доступ' });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const search = screen.getByRole('combobox', { name: 'Сотрудник' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'Антон' } });
    fireEvent.click(await screen.findByRole('option', { name: /Антон Морозов/ }));
    const comment = screen.getByRole('checkbox', { name: 'Комментарии' });
    const edit = screen.getByRole('checkbox', { name: 'Редактирование' });
    const download = screen.getByRole('checkbox', { name: 'Экспорт' });
    expect(comment).toBeEnabled();
    fireEvent.click(comment);
    fireEvent.click(edit);
    fireEvent.click(download);
    expect(comment).toBeChecked();
    expect(edit).toBeChecked();
    expect(download).toBeChecked();
    fireEvent.click(screen.getAllByRole('button', { name: 'Предоставить доступ' }).at(-1)!);
    await waitFor(() =>
        expect(saved).toEqual({
            revision: 1,
            grants: [{ user_id: 2, read: true, comment: true, edit: true, export: true }],
        })
    );
    client.clear();
});
