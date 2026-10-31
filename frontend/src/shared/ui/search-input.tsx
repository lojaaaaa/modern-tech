import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from './button';
export const SearchInput = ({
    initialValue,
    onSearch,
    busy = false,
}: {
    initialValue: string;
    onSearch: (value: string) => void;
    busy?: boolean;
}) => {
    const [draft, setDraft] = useState({ base: initialValue, value: initialValue });
    if (draft.base !== initialValue) {
        setDraft({ base: initialValue, value: initialValue });
    }
    const value = draft.value;
    const setValue = (next: string) => setDraft({ base: initialValue, value: next });
    useEffect(() => {
        if (value === initialValue) {
            return;
        }
        const timer = window.setTimeout(() => onSearch(value), 350);
        return () => window.clearTimeout(timer);
    }, [value, initialValue, onSearch]);
    return (
        <div className="search-field" aria-busy={busy}>
            <Search size={18} />
            <input
                maxLength={500}
                aria-label="Поиск документов"
                placeholder="Поиск по документам"
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
            {busy && <span className="search-spinner" aria-label="Поиск…" />}
        </div>
    );
};
