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

it('registers a visitor and shows the account-specific email verification step', async () => {
    const requests: { path: string; body: unknown }[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (path: string, init?: RequestInit) => {
            requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
            if (path === '/api/v1/me') {
                return new Response('{}', { status: 401 });
            }
            if (path === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (path === '/api/v1/auth/register') {
                return Response.json(
                    {
                        data: {
                            id: 11,
                            name: 'Новый сотрудник',
                            email: 'visitor@example.test',
                            role: 'employee',
                            active: true,
                            email_verified_at: null,
                        },
                    },
                    { status: 201 }
                );
            }
            throw new Error('Unexpected request: ' + path);
        })
    );
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/register']}>
                <App />
            </MemoryRouter>
        </QueryClientProvider>
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Ваше имя'), 'Новый сотрудник');
    await user.type(screen.getByLabelText('Электронная почта'), 'visitor@example.test');
    await user.type(screen.getByLabelText('Пароль'), 'A-secure-password-2026!');
    await user.type(screen.getByLabelText('Повторите пароль'), 'A-secure-password-2026!');
    await user.click(screen.getByRole('button', { name: 'Создать учётную запись' }));
    expect(await screen.findByRole('heading', { name: 'Подтвердите электронную почту' })).toBeVisible();
    expect(screen.getByText('visitor@example.test', { exact: false })).toBeVisible();
    expect(requests.find((request) => request.path === '/api/v1/auth/register')?.body).toEqual({
        name: 'Новый сотрудник',
        email: 'visitor@example.test',
        password: 'A-secure-password-2026!',
        password_confirmation: 'A-secure-password-2026!',
    });
});
