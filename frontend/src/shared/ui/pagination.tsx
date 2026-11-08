import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
export const Pagination = ({
    page,
    pages,
    onChange,
    busy = false,
    label = 'Страницы журнала',
}: {
    page: number;
    pages: number;
    onChange: (page: number) => void;
    busy?: boolean;
    label?: string;
}) => {
    const numbers = Array.from(new Set([1, page - 1, page, page + 1, pages]))
        .filter((n) => n >= 1 && n <= pages)
        .sort((a, b) => a - b);
    return (
        <nav className="pagination" aria-label={label}>
            <span>
                Страница {page} из {pages}
            </span>
            <div>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Предыдущая страница"
                    disabled={busy || page <= 1}
                    onClick={() => onChange(page - 1)}
                >
                    <ChevronLeft size={17} />
                </Button>
                {numbers.map((n, i) => (
                    <span key={n}>
                        {i > 0 && n > (numbers[i - 1] ?? 0) + 1 && <span className="pagination-gap">…</span>}
                        <Button
                            variant={n === page ? 'default' : 'ghost'}
                            size="icon"
                            aria-current={n === page ? 'page' : undefined}
                            disabled={busy}
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
                    disabled={busy || page >= pages}
                    onClick={() => onChange(page + 1)}
                >
                    <ChevronRight size={17} />
                </Button>
            </div>
        </nav>
    );
};
