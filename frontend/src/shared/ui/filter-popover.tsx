import { useId, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from './button';
import { Popover } from './popover';

export const FilterPopover = ({
    children,
    count,
    onReset,
}: {
    children: ReactNode;
    count: number;
    onReset: () => void;
}) => (
    <Popover
        label="Фильтры"
        className="table-filter-popover"
        trigger={
            <>
                <SlidersHorizontal size={16} /> Фильтры {count > 0 && <span className="count-pill">{count}</span>}
            </>
        }
    >
        <div className="filter-fields">
            <div className="filter-header">
                <strong>Фильтры</strong>
                <Button variant="ghost" size="small" disabled={count === 0} onClick={onReset}>
                    Сбросить
                </Button>
            </div>
            {children}
        </div>
    </Popover>
);

export const FilterOptions = ({
    label,
    value,
    options,
    onValueChange,
}: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
}) => {
    const name = useId();
    if (options.length > 6) {
        return (
            <label className="filter-select">
                <span>{label}</span>
                <select value={value} onChange={(event) => onValueChange(event.target.value)}>
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
        );
    }

    return (
        <fieldset className="filter-options">
            <legend>{label}</legend>
            <div>
                {options.map((option) => (
                    <label key={option.value}>
                        <input
                            type="radio"
                            name={name}
                            checked={value === option.value}
                            onChange={() => onValueChange(option.value)}
                        />
                        <span>{option.label}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
};
