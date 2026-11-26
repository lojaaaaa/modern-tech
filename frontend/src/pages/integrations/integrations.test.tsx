import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { IntegrationsPage } from './index';

afterEach(() => vi.unstubAllGlobals());
it('separates connections, credentials and transfers by provider', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url.endsWith('/connections/google/authorization')) {
                return Response.json({ data: { available: true } });
            }
            if (url.endsWith('/connections')) {
                return Response.json({
                    data: [
                        { id: 'y', name: 'Рабочий Google', provider: 'google', status: 'connected' },
                        { id: 'm', name: 'Личный Mail', provider: 'mail', status: 'connected' },
                    ],
                });
            }
            if (url.endsWith('/transfers')) {
                return Response.json({
                    data: [
                        {
                            id: '1',
                            connection_id: 'y',
                            filename: 'google.txt',
                            direction: 'import',
                            status: 'completed',
                        },
                        {
                            id: '2',
                            connection_id: 'm',
                            filename: 'mail.txt',
                            direction: 'export',
                            status: 'completed',
                        },
                    ],
                });
            }
            throw new Error('Unexpected request');
        })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <IntegrationsPage />
            </MemoryRouter>
        </QueryClientProvider>
    );
    expect(await screen.findByText('google.txt')).toBeVisible();
    expect(screen.queryByText('mail.txt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Токен доступа Google Driveа')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подключить диск' }));
    expect(screen.getByRole('button', { name: 'Подключить Google Drive' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    fireEvent.click(screen.getByRole('button', { name: /Облако Mail/ }));
    expect(screen.getByText('mail.txt')).toBeVisible();
    expect(screen.queryByText('google.txt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подключить диск' }));
    expect(screen.getByLabelText('Пароль приложения')).toBeVisible();
    expect(screen.queryByLabelText('Токен доступа Google Driveа')).not.toBeInTheDocument();
    client.clear();
});

it('opens the connected disk after returning from Google without asking for a token', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url.endsWith('/connections/google/authorization')) {
                return Response.json({ data: { available: true } });
            }
            if (url.endsWith('/connections')) {
                return Response.json({
                    data: [{ id: 'disk-id', provider: 'google', name: 'Google Drive · Анна', status: 'connected' }],
                });
            }
            if (url.includes('/connections/disk-id/files?')) {
                return Response.json({
                    data: [{ name: 'Договор.docx', path: '/Договор.docx', type: 'file', size: 100 }],
                });
            }
            if (url.endsWith('/transfers')) {
                return Response.json({ data: [] });
            }
            throw new Error('Unexpected request: ' + url);
        })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/integrations?google=connected&connection=disk-id']}>
                <IntegrationsPage />
            </MemoryRouter>
        </QueryClientProvider>
    );
    expect(await screen.findByText('Договор.docx')).toBeVisible();
    expect(screen.getByText('Google Drive подключён.')).toBeVisible();
    expect(screen.queryByLabelText('Токен доступа Google Driveа')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByText('Google Drive подключён.')).not.toBeInTheDocument();
    expect(screen.getByText('Договор.docx')).toBeVisible();
    client.clear();
});

it('explains unavailable server configuration without falling back to a manual token form', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
            Response.json({ data: url.endsWith('/connections/google/authorization') ? { available: false } : [] })
        )
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <IntegrationsPage />
            </MemoryRouter>
        </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Подключить диск' }));
    expect(await screen.findByText('Подключение пока недоступно. Обратитесь к администратору.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Подключить Google Drive' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    client.clear();
});
