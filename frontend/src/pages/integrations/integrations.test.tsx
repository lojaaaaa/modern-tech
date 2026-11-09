import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IntegrationsPage } from './index';
import { MemoryRouter } from 'react-router-dom';
afterEach(() => vi.unstubAllGlobals());
it('separates connections, credentials and transfers by provider', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url.endsWith('/connections/yandex/authorization')) {
                return Response.json({ data: { available: true } });
            }
            if (url.endsWith('/connections')) {
                return Response.json({
                    data: [
                        { id: 'y', name: 'Рабочий Яндекс', provider: 'yandex', status: 'connected' },
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
                            filename: 'yandex.txt',
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
    expect(await screen.findByText('yandex.txt')).toBeVisible();
    expect(screen.queryByText('mail.txt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Токен доступа Яндекс Диска')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить Яндекс Диск' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Облако Mail/ }));
    expect(screen.getByText('mail.txt')).toBeVisible();
    expect(screen.queryByText('yandex.txt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Пароль приложения')).toBeVisible();
    expect(screen.queryByLabelText('Токен доступа Яндекс Диска')).not.toBeInTheDocument();
    client.clear();
});

it('opens the connected disk after returning from Yandex without asking for a token', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url.endsWith('/connections/yandex/authorization')) {
                return Response.json({ data: { available: true } });
            }
            if (url.endsWith('/connections')) {
                return Response.json({
                    data: [{ id: 'disk-id', provider: 'yandex', name: 'Яндекс Диск · Анна', status: 'connected' }],
                });
            }
            if (url.includes('/connections/disk-id/files?')) {
                return Response.json({
                    data: [{ name: 'Договор.docx', path: 'disk:/Договор.docx', type: 'file', size: 100 }],
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
            <MemoryRouter initialEntries={['/integrations?yandex=connected&connection=disk-id']}>
                <IntegrationsPage />
            </MemoryRouter>
        </QueryClientProvider>
    );
    expect(await screen.findByText('Договор.docx')).toBeVisible();
    expect(screen.getByText('Яндекс Диск подключён.')).toBeVisible();
    expect(screen.queryByLabelText('Токен доступа Яндекс Диска')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByText('Яндекс Диск подключён.')).not.toBeInTheDocument();
    expect(screen.getByText('Договор.docx')).toBeVisible();
    client.clear();
});

it('explains unavailable server configuration without falling back to a manual token form', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
            Response.json({ data: url.endsWith('/connections/yandex/authorization') ? { available: false } : [] })
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
    expect(await screen.findByText('Подключение пока недоступно. Обратитесь к администратору.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Подключить Яндекс Диск' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    client.clear();
});
