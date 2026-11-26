import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StructuredPreview } from './StructuredPreview';
import { parseTables } from './parseTables';
import { apiBlob } from '@/shared/api/client';

vi.mock('@/shared/api/client', () => ({ apiBlob: vi.fn() }));

it('renders Markdown headings and tables without executing HTML or loading remote images', async () => {
    vi.mocked(apiBlob).mockResolvedValue({
        size: 200,
        text: async () =>
            '# Заголовок\n\n**Важно**\n\n| А | Б |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n![Фото](https://example.com/track.png)\n\n[Опасно](javascript:alert)',
    } as Blob);

    const { container } = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <StructuredPreview versionId="v1" kind="markdown" />
        </QueryClientProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Заголовок', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('Важно');
    expect(container.querySelector('script, img, a[href^="javascript:"]')).toBeNull();
});

it('parses quoted CSV cells, multiline values and semicolon delimiters', async () => {
    const blob = { text: async () => 'Имя;Описание\nАнна;"Смета; этап 1\nЭтап 2"\nБорис;""' } as Blob;
    const result = await parseTables(blob, 'csv');
    expect(result[0]?.rows).toEqual([
        ['Имя', 'Описание'],
        ['Анна', 'Смета; этап 1\nЭтап 2'],
        ['Борис', ''],
    ]);
});
