import { queryKeys } from '@/shared/api/query-keys';
import { diffLines } from 'diff';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { Resource, Version } from '@/shared/api/types';
import { Select } from '@/shared/ui/select';
import { Button } from '@/shared/ui/button';
import { Popover } from '@/shared/ui/popover';
import { Info } from 'lucide-react';
import { ErrorMessage } from '@/shared/ui/error-message';

export const VersionCompare = ({ versions }: { versions: Version[] }) => {
    const [left, setLeft] = useState(versions[1]?.id ?? '');
    const [right, setRight] = useState(versions[0]?.id ?? '');
    const [comparison, setComparison] = useState<{ left: string; right: string } | null>(null);
    const before = useQuery({
        queryKey: [queryKeys.documentText, comparison?.left],
        queryFn: ({ signal }) =>
            api<Resource<{ text: string | null }>>(`/versions/${comparison?.left}/text`, { signal }),
        enabled: !!comparison,
    });
    const after = useQuery({
        queryKey: [queryKeys.documentText, comparison?.right],
        queryFn: ({ signal }) =>
            api<Resource<{ text: string | null }>>(`/versions/${comparison?.right}/text`, { signal }),
        enabled: !!comparison,
    });
    const options = versions.map((v) => ({ value: v.id, label: `Версия ${v.number}` }));
    const changes = useMemo(
        () => diffLines(before.data?.data.text ?? '', after.data?.data.text ?? ''),
        [before.data?.data.text, after.data?.data.text]
    );
    return (
        <div className="version-compare">
            <div className="section-heading">
                <h2>Сравнение версий</h2>
                <Popover
                    label="Сравнение текста"
                    align="end"
                    trigger={
                        <>
                            <Info size={16} /> Сравнение текста
                        </>
                    }
                >
                    <p className="filter-fields">
                        Сравнивается извлечённый текст. Оформление, изображения и расположение элементов не учитываются.
                    </p>
                </Popover>
            </div>
            <form
                className="compare-pickers"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (left && right && left !== right) {
                        setComparison({ left, right });
                    }
                }}
            >
                <Select
                    label="Исходная версия"
                    value={left}
                    onValueChange={setLeft}
                    options={options.filter((option) => option.value !== right)}
                />
                <Select
                    label="Новая версия"
                    value={right}
                    onValueChange={setRight}
                    options={options.filter((option) => option.value !== left)}
                />
                <Button disabled={!left || !right || left === right}>Сравнить</Button>
            </form>
            <ErrorMessage error={before.error || after.error} />
            {before.isFetching || after.isFetching ? (
                <p role="status">Загружаем тексты версий…</p>
            ) : before.isError || after.isError || !comparison ? null : !left || !right ? (
                <p className="empty-state">Выберите две версии документа.</p>
            ) : !before.data?.data.text && !after.data?.data.text ? (
                <p className="empty-state">В выбранных версиях нет извлечённого текста.</p>
            ) : (
                <>
                    <p className="diff-summary">
                        <span>− {changes.filter((item) => item.removed).length} удалённых фрагментов</span>
                        <span>+ {changes.filter((item) => item.added).length} добавленных фрагментов</span>
                    </p>
                    <div className="compare-columns">
                        <pre aria-label="Исходный текст">
                            {changes
                                .filter((part) => !part.added)
                                .map((part, i) => (
                                    <span key={i} className={part.removed ? 'diff-before' : ''}>
                                        {part.value}
                                    </span>
                                ))}
                        </pre>
                        <pre aria-label="Новый текст">
                            {changes
                                .filter((part) => !part.removed)
                                .map((part, i) => (
                                    <span key={i} className={part.added ? 'diff-after' : ''}>
                                        {part.value}
                                    </span>
                                ))}
                        </pre>
                    </div>
                </>
            )}
        </div>
    );
};
