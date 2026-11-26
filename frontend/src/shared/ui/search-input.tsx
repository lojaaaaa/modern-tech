import { useEffect, useEffectEvent, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from './button';

export const SearchInput = ({
    initialValue,
    onSearch,
    isBusy = false,
    label = 'Поиск документов',
    placeholder = 'Поиск по документам',
    maxLength = 500,
}: {
    initialValue: string;
    onSearch: (value: string) => void;
    isBusy?: boolean;
    label?: string;
    placeholder?: string;
    maxLength?: number;
}) => {
    const [draft, setDraft] = useState({ base: initialValue, value: initialValue });
    if (draft.base !== initialValue) {
        setDraft({ base: initialValue, value: initialValue });
    }
    const value = draft.value;
    const submit = useEffectEvent(onSearch);
    const setValue = (next: string) => setDraft({ base: initialValue, value: next });
    useEffect(() => {
        if (value === initialValue) {
            return;
        }
        const timer = window.setTimeout(() => submit(value), 350);

        return () => window.clearTimeout(timer);
    }, [value, initialValue]);

    return (
        <div className="search-field" aria-busy={isBusy}>
            <Search size={18} />
            <input
                maxLength={maxLength}
                aria-label={label}
                placeholder={placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        onSearch(value);
                    }
                    if (e.key === 'Escape') {
                        setValue('');
                        onSearch('');
                    }
                }}
            />
            {value && (
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Очистить поиск"
                    onClick={() => {
                        setValue('');
                        onSearch('');
                    }}
                >
                    <X size={15} />
                </Button>
            )}
            {isBusy && <span className="search-spinner" aria-label="Поиск…" />}
        </div>
    );
};
