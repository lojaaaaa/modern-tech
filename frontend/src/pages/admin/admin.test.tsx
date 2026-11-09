import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, test, expect } from 'vitest';
import { UsersPage } from './index';

test('uses cursors and resets them when user filters change', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const requests: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
            requests.push(String(input));
            return Response.json({ data: [], meta: { next_cursor: 'next-token', prev_cursor: null, per_page: 20 } });
        })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <UsersPage />
        </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Дальше' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(requests.some((url) => url.includes('cursor=next-token'))).toBe(true));
    fireEvent.click(screen.getByRole('combobox', { name: 'Статус' }));
    fireEvent.click(screen.getByRole('option', { name: 'Заблокирован' }));
    await waitFor(() => expect(requests.at(-1)).toContain('active=0'));
    expect(requests.at(-1)).not.toContain('cursor=');
    expect(screen.queryByText(/Страница/)).not.toBeInTheDocument();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.unstubAllGlobals();
});
