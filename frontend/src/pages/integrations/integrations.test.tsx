import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IntegrationsPage } from './index';
afterEach(() => vi.unstubAllGlobals());
it('separates connections, credentials and transfers by provider', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
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
            <IntegrationsPage />
        </QueryClientProvider>
    );
    expect(await screen.findByText('yandex.txt')).toBeVisible();
    expect(screen.queryByText('mail.txt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Токен доступа Яндекс Диска')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Облако Mail/ }));
    expect(screen.getByText('mail.txt')).toBeVisible();
    expect(screen.queryByText('yandex.txt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Пароль приложения')).toBeVisible();
    expect(screen.queryByLabelText('Токен доступа Яндекс Диска')).not.toBeInTheDocument();
    client.clear();
});
