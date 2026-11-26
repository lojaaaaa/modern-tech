import { useDismiss } from '@/shared/lib/use-dismiss';
import { useRef, useState, useLayoutEffect } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from './button';

export const DatePicker = ({
    value,
    onChange,
    label,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
}) => {
    const [isOpen, setOpen] = useState(false);

    const trigger = useRef<HTMLButtonElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!isOpen || !trigger.current || !popup.current) {
            return;
        }
        const rect = trigger.current.getBoundingClientRect();
        const width = Math.min(288, window.innerWidth - 24);
        Object.assign(popup.current.style, {
            left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
            top: `${rect.bottom + 330 > window.innerHeight ? Math.max(12, rect.top - 330) : rect.bottom + 6}px`,
            width: `${width}px`,
        });
        popup.current.showPopover?.();
    }, [isOpen]);
    const root = useRef<HTMLDivElement>(null);

    const [month, setMonth] = useState(() => (value ? new Date(`${value}T12:00:00`) : new Date()));
    useDismiss(root, isOpen, () => setOpen(false));
    const year = month.getFullYear();
    const index = month.getMonth();
    const count = new Date(year, index + 1, 0).getDate();
    const offset = (new Date(year, index, 1).getDay() + 6) % 7;
    const key = (day: number) => `${year}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    return (
        <div
            ref={root}
            className="date-picker"
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                    setOpen(false);
                }
            }}
        >
            <button
                ref={trigger}
                type="button"
                className="date-trigger"
                aria-label={label}
                aria-expanded={isOpen}
                onClick={() => setOpen(!isOpen)}
            >
                <CalendarDays size={15} />
                <span>{value ? new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU') : 'Выбрать дату'}</span>
            </button>
            {isOpen && (
                <div
                    ref={popup}
                    popover="manual"
                    className="calendar-popover"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setOpen(false);
                        }
                    }}
                >
                    <header>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Предыдущий месяц"
                            onClick={() => setMonth(new Date(year, index - 1, 1))}
                        >
                            <ChevronLeft size={16} />
                        </Button>
                        <strong>{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</strong>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Следующий месяц"
                            onClick={() => setMonth(new Date(year, index + 1, 1))}
                        >
                            <ChevronRight size={16} />
                        </Button>
                    </header>
                    <div className="calendar-grid">
                        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
                            <small key={d}>{d}</small>
                        ))}
                        {Array.from({ length: offset }, (_, i) => (
                            <span key={`blank-${i}`} />
                        ))}
                        {Array.from({ length: count }, (_, i) => i + 1).map((day) => (
                            <button
                                type="button"
                                key={day}
                                aria-pressed={value === key(day)}
                                onClick={() => {
                                    onChange(key(day));
                                    setOpen(false);
                                }}
                            >
                                {day}
                            </button>
                        ))}
                    </div>
                    <footer>
                        <Button
                            size="small"
                            variant="ghost"
                            onClick={() => {
                                const now = new Date();
                                onChange(
                                    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                                );
                                setOpen(false);
                            }}
                        >
                            Сегодня
                        </Button>
                        <Button
                            size="small"
                            variant="ghost"
                            onClick={() => {
                                onChange('');
                                setOpen(false);
                            }}
                        >
                            <X size={13} />
                            Очистить
                        </Button>
                    </footer>
                </div>
            )}
        </div>
    );
};
