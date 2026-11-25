import { useId, type ReactNode } from 'react';
import { Button } from './button';

export const Popover = ({
    trigger,
    label,
    children,
    align = 'start',
    variant = 'secondary',
}: {
    trigger: ReactNode;
    label: string;
    children: ReactNode | ((close: () => void) => ReactNode);
    align?: 'start' | 'end';
    variant?: 'default' | 'secondary' | 'ghost';
}) => {
    const id = useId();
    const close = () => {
        document.getElementById(id)?.hidePopover?.();
        document.getElementById(`${id}-trigger`)?.focus();
    };

    return (
        <div className="popover">
            <Button
                id={`${id}-trigger`}
                type="button"
                variant={variant}
                aria-label={label}
                title={label}
                popoverTarget={id}
            >
                {trigger}
            </Button>
            <div id={id} popover="auto" role="group" aria-label={label} className="popover-content" data-align={align}>
                {typeof children === 'function' ? children(close) : children}
            </div>
        </div>
    );
};
