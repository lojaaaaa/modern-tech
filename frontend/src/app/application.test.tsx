import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from './application';
import { client } from './query-client';
afterEach(() => {
    client.clear();
    vi.unstubAllGlobals();
});
it('moves from anonymous session to library and back without leaving a pending observer', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url === '/api/v1/me') {
                return new Response('{}', { status: 401 });
            }
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url === '/api/v1/auth/login') {
                return Response.json({
                    data: {
                        id: 1,
                        name: 'Test',
                        email: 'test@example.invalid',
                        role: 'employee',
                        active: true,
                    },
                });
            }
            if (url.startsWith('/api/v1/documents?')) {
                return Response.json({
                    data: [],
                    meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 },
                });
            }
            if (url === '/api/v1/auth/logout') {
                return Response.json({ data: null });
            }
            throw new Error('Unexpected request: ' + url);
        })
    );
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <App />
            </MemoryRouter>
        </QueryClientProvider>
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Электронная почта'), 'test@example.invalid');
    await user.type(screen.getByLabelText('Пароль'), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Войти в пространство' }));
    expect(await screen.findByRole('heading', { name: /Все документы/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(await screen.findByRole('heading', { name: 'С возвращением' })).toBeVisible();
});

it('clears selection when navigating between trash and documents in both directions', async () => {
    const account = { id: 1, name: 'Test', email: 'test@example.invalid', role: 'employee', active: true };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url === '/api/v1/me') {
                return Response.json({ data: account });
            }
            if (url.startsWith('/api/v1/documents?')) {
                return Response.json({
                    data: [
                        {
                            id: 'document-1',
                            title: 'Проверка выбора',
                            owner: account,
                            updated_at: '2026-10-31T10:00:00Z',
                            processing_status: 'ready',
                            version: null,
                        },
                    ],
                    meta: { current_page: 1, last_page: 1, per_page: 12, total: 1 },
                });
            }
            throw new Error('Unexpected request: ' + url);
        })
    );
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/trash']}>
                <App />
            </MemoryRouter>
        </QueryClientProvider>
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Выбрать Проверка выбора' }));
    expect(screen.getByText('Выбрано: 1')).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Все документы' }));
    expect(await screen.findByRole('checkbox', { name: 'Выбрать Проверка выбора' })).not.toBeChecked();
    expect(screen.queryByText('Выбрано: 1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать Проверка выбора' }));
    expect(screen.getByText('Выбрано: 1')).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Корзина' }));
    expect(await screen.findByRole('checkbox', { name: 'Выбрать Проверка выбора' })).not.toBeChecked();
    expect(screen.queryByText('Выбрано: 1')).not.toBeInTheDocument();
});
