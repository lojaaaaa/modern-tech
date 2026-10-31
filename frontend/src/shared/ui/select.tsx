import { useDismiss } from '@/shared/lib/use-dismiss';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
export const Select = ({
    value,
    onValueChange,
    options,
    label,
    placeholder = 'Выберите…',
}: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    label: string;
    placeholder?: string;
}) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    useDismiss(root, open, () => setOpen(false));
    useEffect(() => {
        if (open && menu.current && trigger.current) {
            const rect = trigger.current.getBoundingClientRect();
            const height = Math.min(240, options.length * 39 + 10);
            Object.assign(menu.current.style, {
                position: 'fixed',
                margin: '0',
                left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`,
                top: `${rect.bottom + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6}px`,
                width: `${rect.width}px`,
                right: 'auto',
            });
            menu.current.showPopover?.();
        }
    }, [open, options.length]);
    useEffect(() => {
        if (open) {
            document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
        }
    }, [active, id, open]);
    const choose = (index: number) => {
        const option = options[index];
        if (option) {
            onValueChange(option.value);
        }
        setOpen(false);
        trigger.current?.focus();
    };
    return (
        <div
            ref={root}
            className="custom-select"
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                    setOpen(false);
                }
            }}
        >
            <button
                ref={trigger}
                type="button"
                role="combobox"
                aria-label={label}
                aria-expanded={open}
                aria-controls={`${id}-list`}
                aria-activedescendant={open ? `${id}-${active}` : undefined}
                aria-haspopup="listbox"
                className="select-trigger"
                onClick={() => {
                    setActive(
                        Math.max(
                            0,
                            options.findIndex((o) => o.value === value)
                        )
                    );
                    setOpen(!open);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setOpen(false);
                        e.preventDefault();
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        setOpen(true);
                        setActive((i) =>
                            Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
                        );
                    } else if (open && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        choose(active);
                    } else if (open && (e.key === 'Home' || e.key === 'End')) {
                        e.preventDefault();
                        setActive(e.key === 'Home' ? 0 : options.length - 1);
                    }
                }}
            >
                <span>{options.find((o) => o.value === value)?.label ?? placeholder}</span>
                <ChevronDown size={16} />
            </button>
            {open && (
                <div
                    ref={menu}
                    popover="manual"
                    id={`${id}-list`}
                    role="listbox"
                    aria-label={label}
                    className="select-options"
                >
                    {options.map((option, i) => (
                        <div
                            role="option"
                            id={`${id}-${i}`}
                            aria-selected={value === option.value}
                            key={option.value}
                            className={i === active ? 'select-option active' : 'select-option'}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseMove={() => setActive(i)}
                            onClick={() => choose(i)}
                        >
                            {option.label}
                            {value === option.value && <Check size={15} />}
                        </div>
                    ))}
                    {!options.length && <div className="select-option muted">Нет вариантов</div>}
                </div>
            )}
        </div>
    );
};
