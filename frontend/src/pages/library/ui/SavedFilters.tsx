import { Button } from '@/shared/ui/button';
import { Popover } from '@/shared/ui/popover';
import { ListFilter, Save, X } from 'lucide-react';
import { useState } from 'react';
import type { useLibraryModel } from '../model/useLibraryModel';

type Props = Pick<
    ReturnType<typeof useLibraryModel>,
    'params' | 'setParams' | 'filters' | 'viewsKey' | 'setSelected' | 'page' | 'query'
>;
export const SavedFilters = ({ params, setParams, viewsKey, setSelected }: Props) => {
    const [views, setViews] = useState<{ name: string; query: string }[]>(() => {
        try {
            const stored: unknown = JSON.parse(localStorage.getItem(viewsKey) ?? '[]');

            return Array.isArray(stored)
                ? stored.filter(
                      (item): item is { name: string; query: string } =>
                          item !== null &&
                          typeof item === 'object' &&
                          typeof item.name === 'string' &&
                          typeof item.query === 'string'
                  )
                : [];
        } catch {
            return [];
        }
    });

    const [viewName, setViewName] = useState('');
    const [isSaving, setSaving] = useState(false);

    return (
        <Popover label="Сохранённые фильтры" className="saved-filters-trigger" trigger={<ListFilter size={16} />}>
            {(close) => (
                <div className="filter-fields saved-filter-list">
                    <div className="filter-header">
                        <strong>Сохранённые фильтры</strong>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Сохранить текущие фильтры"
                            onClick={() => {
                                setViewName('');
                                setSaving((isOpen) => !isOpen);
                            }}
                        >
                            <Save size={16} />
                        </Button>
                    </div>
                    {views.length === 0 && !isSaving && <p className="muted">Сохранённых фильтров пока нет.</p>}

                    {views.map((view, i) => (
                        <span key={view.name}>
                            <Button
                                variant="ghost"
                                size="small"
                                onClick={() => {
                                    setSelected([]);
                                    setParams(view.query);
                                    close();
                                }}
                            >
                                {view.name}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Удалить представление ${view.name}`}
                                onClick={() => {
                                    const next = views.filter((_, n) => n !== i);
                                    setViews(next);
                                    localStorage.setItem(viewsKey, JSON.stringify(next));
                                }}
                            >
                                <X size={12} />
                            </Button>
                        </span>
                    ))}
                    {isSaving && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!viewName.trim()) {
                                    return;
                                }

                                const next = [
                                    ...views.filter((v) => v.name !== viewName.trim()),
                                    {
                                        name: viewName.trim(),
                                        query: new URLSearchParams(
                                            [...params].filter(([key]) => key !== 'page')
                                        ).toString(),
                                    },
                                ].slice(-10);

                                setViews(next);
                                localStorage.setItem(viewsKey, JSON.stringify(next));
                                setSaving(false);
                                setViewName('');
                            }}
                        >
                            <input
                                autoFocus
                                required
                                aria-label="Название фильтра"
                                maxLength={40}
                                value={viewName}
                                onChange={(e) => setViewName(e.target.value)}
                                placeholder="Название фильтра"
                            />

                            <Button type="button" size="small" variant="secondary" onClick={() => setSaving(false)}>
                                Отмена
                            </Button>
                            <Button size="small" disabled={!viewName.trim()}>
                                Сохранить
                            </Button>
                        </form>
                    )}
                </div>
            )}
        </Popover>
    );
};
