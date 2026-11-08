import { diffLines } from 'diff';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { Resource, Version } from '@/shared/api/types';
import { Select } from '@/shared/ui/select';
import { ErrorMessage } from '@/shared/ui/error-message';

export const VersionCompare = ({ versions }: { versions: Version[] }) => {
    const [left, setLeft] = useState(versions[1]?.id ?? '');
    const [right, setRight] = useState(versions[0]?.id ?? '');
    const before = useQuery({
        queryKey: ['document-text', left],
        queryFn: ({ signal }) => api<Resource<{ text: string | null }>>(`/versions/${left}/text`, { signal }),
        enabled: !!left,
    });
    const after = useQuery({
        queryKey: ['document-text', right],
        queryFn: ({ signal }) => api<Resource<{ text: string | null }>>(`/versions/${right}/text`, { signal }),
        enabled: !!right,
    });
    const options = versions.map((v) => ({ value: v.id, label: `Версия ${v.number}` }));
    const changes = useMemo(
        () => diffLines(before.data?.data.text ?? '', after.data?.data.text ?? ''),
        [before.data?.data.text, after.data?.data.text]
    );
    return (
        <div className="version-compare">
            <p className="muted">
                Сравнивается извлечённый текст. Оформление, изображения и расположение элементов не учитываются.
            </p>
            <div className="compare-pickers">
                <Select label="Исходная версия" value={left} onValueChange={setLeft} options={options} />
                <Select label="Новая версия" value={right} onValueChange={setRight} options={options} />
            </div>
            <ErrorMessage error={before.error || after.error} />
            {before.isFetching || after.isFetching ? (
                <p role="status">Загружаем тексты версий…</p>
            ) : before.isError || after.isError ? null : !left || !right ? (
                <p className="empty-state">Для сравнения нужны две версии документа.</p>
            ) : !before.data?.data.text && !after.data?.data.text ? (
                <p className="empty-state">В выбранных версиях нет извлечённого текста.</p>
            ) : (
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
            )}
        </div>
    );
};
