import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export const DataTable = ({
    children,
    className,
    isBusy = false,
}: {
    children: ReactNode;
    className?: string;
    isBusy?: boolean;
}) => (
    <table className={cn('documents-table', className)} aria-busy={isBusy || undefined}>
        {children}
    </table>
);

export const TableSkeleton = ({ label }: { label: string }) => (
    <div className="table-skeleton" role="status" aria-label={label}>
        {Array.from({ length: 4 }, (_, row) => (
            <div key={row} aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
        ))}
    </div>
);

export const TableViewport = ({
    children,
    className,
    isPlaceholderData = false,
}: {
    children: ReactNode;
    className?: string;
    isPlaceholderData?: boolean;
}) => (
    <div className={cn('table-scroll', className)} inert={isPlaceholderData || undefined}>
        {children}
    </div>
);

export const TableToolbar = ({ children, label }: { children: ReactNode; label: string }) => (
    <section className="list-toolbar" aria-label={label}>
        {children}
    </section>
);
