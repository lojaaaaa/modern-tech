import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, test, expect } from 'vitest';
import { UsersPage } from './index';

test('uses cursors and resets them when user filters change', async () => {
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
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: '0' } });
    await waitFor(() => expect(requests.at(-1)).toContain('active=0'));
    expect(requests.at(-1)).not.toContain('cursor=');
    expect(screen.queryByText(/Страница/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
});
