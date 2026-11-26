import type { ReactNode } from 'react';
import { Button } from './button';

export const SelectionToolbar = ({
    count,
    isBusy,
    onClear,
    children,
}: {
    count: number;
    isBusy: boolean;
    onClear: () => void;
    children: ReactNode;
}) => (
    <div className="batch-toolbar" role="group" aria-label="Массовые действия" aria-busy={isBusy || undefined}>
        <span role="status">Выбрано на странице: {count}</span>
        {children}
        <Button variant="ghost" size="small" disabled={isBusy} onClick={onClear}>
            Снять выбор
        </Button>
    </div>
);
