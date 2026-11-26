import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ParticipantSelect } from './ParticipantSelect';

afterEach(() => vi.unstubAllGlobals());
it('searches remotely, excludes granted users and selects a person with the keyboard', async () => {
    const fetch = vi.fn(async (url: string) => {
        expect(url).toContain('/participants?');

        return Response.json({
            data: [
                { id: 1, name: 'Антон Морозов', email: 'anton@example.test', role: 'employee' },
                { id: 2, name: 'Антон Второй', role: 'employee' },
            ],
        });
    });

    vi.stubGlobal('fetch', fetch);
    const select = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ParticipantSelect documentId="doc" excluded={[2]} onSelect={select} />
        </QueryClientProvider>
    );
    const input = screen.getByRole('combobox', { name: 'Сотрудник' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Антон' } });
    expect(await screen.findByRole('option', { name: /Антон Морозов/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /Второй/ })).not.toBeInTheDocument();
    await waitFor(() => expect(fetch.mock.calls.some((call) => String(call[0]).includes('search='))).toBe(true));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }));
    expect(input).toHaveValue('Антон Морозов');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    client.clear();
});
