import { api } from '@/shared/api/client';
import type { Resource } from '@/shared/api/types';
import { useDismiss } from '@/shared/lib/use-dismiss';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

type Participant = { id: number; name: string; email?: string; role: string };
export const ParticipantSelect = ({
    documentId,
    excluded,
    onSelect,
}: {
    documentId: string;
    excluded: number[];
    onSelect: (person: Participant | null) => void;
}) => {
    const [text, setText] = useState('');
    const [term, setTerm] = useState('');
    const [isOpen, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const id = useId();
    useDismiss(root, isOpen, () => setOpen(false));
    useEffect(() => {
        const timer = window.setTimeout(() => setTerm(text.trim()), 250);

        return () => window.clearTimeout(timer);
    }, [text]);

    const result = useQuery({
        queryKey: ['participant-search', documentId, term],
        queryFn: ({ signal }) =>
            api<Resource<Participant[]>>(
                `/documents/${documentId}/participants?${new URLSearchParams({ search: term })}`,
                { signal }
            ),
        enabled: isOpen,
    });

    const people = (result.data?.data ?? []).filter((person) => !excluded.includes(person.id));

    const choose = (person: Participant) => {
        setText(person.name);
        onSelect(person);
        setOpen(false);
    };

    return (
        <div className="participant-select" ref={root}>
            <label htmlFor={id}>Сотрудник</label>
            <div className="participant-search-field">
                <Search size={16} aria-hidden="true" />
                <input
                    id={id}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isOpen}
                    aria-controls={`${id}-options`}
                    aria-activedescendant={isOpen && people[active] ? `${id}-${active}` : undefined}
                    maxLength={120}
                    autoComplete="off"
                    placeholder="Введите имя или почту…"
                    value={text}
                    onFocus={() => setOpen(true)}
                    onChange={(event) => {
                        setText(event.target.value);
                        onSelect(null);
                        setActive(0);
                        setOpen(true);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            setOpen(true);
                            setActive((index) =>
                                Math.max(0, Math.min(people.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
                            );
                        }
                        if (event.key === 'Enter' && isOpen) {
                            event.preventDefault();
                            if (!result.isFetching && term === text.trim() && people[active]) {
                                choose(people[active]);
                            }
                        }
                        if (event.key === 'Escape') {
                            event.stopPropagation();
                            setOpen(false);
                        }
                        if (event.key === 'Tab') {
                            setOpen(false);
                        }
                    }}
                />
            </div>
            {isOpen && (
                <div id={`${id}-options`} role="listbox" aria-label="Сотрудники" className="participant-options">
                    {result.isFetching || term !== text.trim() ? (
                        <p role="status">Ищем сотрудников…</p>
                    ) : result.isError ? (
                        <p role="alert">Не удалось загрузить список. Измените запрос или откройте поле снова.</p>
                    ) : people.length ? (
                        people.map((person, index) => (
                            <button
                                type="button"
                                role="option"
                                aria-selected={index === active}
                                id={`${id}-${index}`}
                                key={person.id}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => choose(person)}
                            >
                                <strong>{person.name}</strong>
                                <small>{person.email}</small>
                            </button>
                        ))
                    ) : (
                        <p>Сотрудники не найдены</p>
                    )}
                </div>
            )}
        </div>
    );
};
