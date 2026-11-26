import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

const PaginationLayout = ({
    label,
    count,
    isBusy,
    children,
}: {
    label: string;
    count?: number | undefined;
    isBusy: boolean;
    children?: ReactNode;
}) => (
    <nav className="pagination" aria-label={label} aria-busy={isBusy || undefined}>
        <span>{count === undefined ? '' : Intl.NumberFormat('ru-RU').format(count) + ' · всего записей'}</span>
        {children && <div>{children}</div>}
    </nav>
);

export const CursorPagination = ({
    meta,
    isBusy,
    onChange,
}: {
    meta: { prev_cursor: string | null; next_cursor: string | null } | undefined;
    isBusy: boolean;
    onChange: (cursor: string) => void;
}) => {
    const previous = meta?.prev_cursor;
    const next = meta?.next_cursor;
    if (!previous && !next) {
        return null;
    }

    return (
        <PaginationLayout label="Навигация по списку" isBusy={isBusy}>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Назад"
                disabled={isBusy || !previous}
                onClick={() => previous && onChange(previous)}
            >
                <ChevronLeft size={17} />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Дальше"
                disabled={isBusy || !next}
                onClick={() => next && onChange(next)}
            >
                <ChevronRight size={17} />
            </Button>
        </PaginationLayout>
    );
};

export const Pagination = ({
    page,
    pages,
    count,
    onChange,
    isBusy = false,
    label = 'Страницы журнала',
}: {
    page: number;
    pages: number;
    count?: number | undefined;
    onChange: (page: number) => void;
    isBusy?: boolean;
    label?: string;
}) => {
    if (pages <= 1) {
        return <PaginationLayout label={label} count={count} isBusy={isBusy} />;
    }

    const numbers = Array.from(new Set([1, page - 1, page, page + 1, pages]))
        .filter((n) => n >= 1 && n <= pages)
        .sort((a, b) => a - b);

    return (
        <PaginationLayout label={label} count={count} isBusy={isBusy}>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Предыдущая страница"
                disabled={isBusy || page <= 1}
                onClick={() => onChange(page - 1)}
            >
                <ChevronLeft size={17} />
            </Button>
            {numbers.map((n, i) => (
                <span key={n}>
                    {i > 0 && n > (numbers[i - 1] ?? 0) + 1 && <span className="pagination-gap">…</span>}
                    <Button
                        variant={n === page ? 'secondary' : 'ghost'}
                        size="icon"
                        aria-current={n === page ? 'page' : undefined}
                        disabled={isBusy}
                        onClick={() => onChange(n)}
                    >
                        {n}
                    </Button>
                </span>
            ))}
            <Button
                variant="ghost"
                size="icon"
                aria-label="Следующая страница"
                disabled={isBusy || page >= pages}
                onClick={() => onChange(page + 1)}
            >
                <ChevronRight size={17} />
            </Button>
        </PaginationLayout>
    );
};
