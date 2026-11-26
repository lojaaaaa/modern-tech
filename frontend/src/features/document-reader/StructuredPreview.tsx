import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiBlob } from '@/shared/api/client';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Spinner } from '@/shared/ui/spinner';
import { Select } from '@/shared/ui/select';
import { Button } from '@/shared/ui/button';
import { parseTables } from './parseTables';

type StructuredPreviewProps = { versionId: string; kind: 'markdown' | 'csv' | 'spreadsheet' };

export const StructuredPreview = ({ versionId, kind }: StructuredPreviewProps) => {
    const [sheetIndex, setSheetIndex] = useState('0');
    const [page, setPage] = useState(0);

    const query = useQuery({
        queryKey: ['structured-preview', versionId, kind],
        queryFn: async ({ signal }) => {
            const blob = await apiBlob(`/versions/${versionId}/preview`, { signal });
            if (blob.size > 10 * 1024 * 1024) {
                throw new Error('Файл слишком большой для встроенного просмотра. Скачайте его для открытия.');
            }

            return kind === 'markdown' ? await blob.text() : await parseTables(blob, kind);
        },
        staleTime: Infinity,
    });

    if (query.isPending) {
        return (
            <div className="empty-state" role="status">
                <Spinner />
                Загружаем документ…
            </div>
        );
    }
    if (query.error) {
        return <ErrorMessage error={query.error} />;
    }
    if (typeof query.data === 'string') {
        return (
            <article className="markdown-preview">
                <Markdown
                    remarkPlugins={[remarkGfm]}
                    skipHtml
                    components={{
                        img: ({ alt }) => <span className="muted">[Изображение: {alt || 'без подписи'}]</span>,
                        a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        ),
                    }}
                >
                    {query.data}
                </Markdown>
            </article>
        );
    }

    const sheets = query.data ?? [];
    const sheet = sheets[Number(sheetIndex)] ?? sheets[0];
    const rows = sheet?.rows ?? [];

    const columns = Math.min(
        50,
        rows.reduce((max, row) => Math.max(max, row.length), 0)
    );

    const totalPages = Math.ceil(rows.length / 100);

    return (
        <div className="spreadsheet-preview">
            <div className="sheet-toolbar">
                {sheets.length > 1 && (
                    <Select
                        label="Лист таблицы"
                        value={sheetIndex}
                        options={sheets.map((item, index) => ({ label: item.name, value: String(index) }))}
                        onValueChange={(value) => {
                            setSheetIndex(value);
                            setPage(0);
                        }}
                    />
                )}
                <span className="muted">
                    {rows.length} строк · {columns} столбцов
                </span>
                {totalPages > 1 && (
                    <div className="sheet-pagination">
                        <Button
                            variant="secondary"
                            size="small"
                            disabled={page === 0}
                            onClick={() => setPage(page - 1)}
                        >
                            Назад
                        </Button>
                        <span>
                            {page + 1} / {totalPages}
                        </span>
                        <Button
                            variant="secondary"
                            size="small"
                            disabled={page + 1 >= totalPages}
                            onClick={() => setPage(page + 1)}
                        >
                            Далее
                        </Button>
                    </div>
                )}
            </div>
            <p className="sheet-notice muted">
                Просмотр значений. Формулы не пересчитываются; оформление и диаграммы доступны в исходном файле.
                Показаны первые 50 столбцов.
            </p>
            {rows.length ? (
                <div className="sheet-scroll" tabIndex={0} role="region" aria-label="Содержимое таблицы">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">№</th>
                                {Array.from({ length: columns }, (_, index) => (
                                    <th key={index} scope="col">
                                        {index + 1}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.slice(page * 100, (page + 1) * 100).map((row, index) => (
                                <tr key={index}>
                                    <th scope="row">{page * 100 + index + 1}</th>
                                    {Array.from({ length: columns }, (_, column) => (
                                        <td key={column}>{row[column] ?? ''}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="empty-state">Лист пуст.</div>
            )}
        </div>
    );
};
