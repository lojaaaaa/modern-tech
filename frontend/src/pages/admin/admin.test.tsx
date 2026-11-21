import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, test, expect } from 'vitest';
import { AuditPage, UsersPage } from './index';

test.each([
    {
        path: '/users',
        Page: UsersPage,
        filter: 'active=0',
        changeFilter: () => {
            fireEvent.click(screen.getByRole('combobox', { name: 'Статус' }));
            fireEvent.click(screen.getByRole('option', { name: 'Заблокирован' }));
        },
    },
    {
        path: '/admin/audit',
        Page: AuditPage,
        filter: 'action=document.updated',
        changeFilter: () =>
            fireEvent.change(screen.getByLabelText('Код события'), { target: { value: 'document.updated' } }),
    },
])('uses cursors and resets them when filters change on $path', async ({ path, Page, filter, changeFilter }) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const requests: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
            requests.push(String(input));
            return Response.json({
                data: [],
                path: `/api/v1${path}`,
                per_page: 20,
                next_cursor: 'next-token',
                next_page_url: `/api/v1${path}?cursor=next-token`,
                prev_cursor: null,
                prev_page_url: null,
            });
        })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <Page />
        </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Дальше' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(requests.some((url) => url.includes('cursor=next-token'))).toBe(true));
    changeFilter();
    await waitFor(() => expect(requests.at(-1)).toContain(filter));
    expect(requests.at(-1)).not.toContain('cursor=');
    expect(screen.queryByText(/Страница/)).not.toBeInTheDocument();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.unstubAllGlobals();
});
