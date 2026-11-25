import { queryKeys } from '@/shared/api/query-keys';
import { DateRangePicker } from '@/shared/ui/date-range-picker';
import { AlertDialog } from '@/shared/ui/alert-dialog';
import { Popover } from '@/shared/ui/popover';
import { Pagination } from '@/shared/ui/pagination';
import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus,
    X,
    BookmarkPlus,
    SlidersHorizontal,
    MoreHorizontal,
    Trash2,
    Download,
    RotateCcw,
    FolderOpen,
} from 'lucide-react';
import { api } from '@/shared/api/client';
import type { DocumentRecord, Page, User } from '@/shared/api/types';
import { Select } from '@/shared/ui/select';
import { SearchInput } from '@/shared/ui/search-input';
import { HighlightedText } from '@/shared/ui/highlighted-text';
import { DataTable, TableSkeleton } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { FileIcon } from '@/shared/ui/file-icon';
import { Status } from '@/shared/ui/status';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes, formatDate } from '@/shared/lib/utils';
import { UploadPanel } from '@/features/upload';
export const LibraryPage = ({ user, isTrash = false }: { user: User; isTrash?: boolean }) => {
    const [params, setParams] = useSearchParams();
    const filters = params.toString();
    const viewsKey = `library-views:${user.id}:${isTrash}`;
    const [views, setViews] = useState<{ name: string; query: string }[]>(() => {
        try {
            return JSON.parse(localStorage.getItem(viewsKey) ?? '[]') as {
                name: string;
                query: string;
            }[];
        } catch {
            return [];
        }
    });
    const [viewName, setViewName] = useState('');
    const [isSaving, setSaving] = useState(false);
    const [selection, setSelection] = useState<{ filters: string; ids: string[] }>({ filters, ids: [] });
    const selected = selection.filters === filters ? selection.ids : [];
    const setSelected = (next: string[] | ((ids: string[]) => string[])) => {
        setSelection((previous) => ({
            filters,
            ids: typeof next === 'function' ? next(previous.filters === filters ? previous.ids : []) : next,
        }));
    };
    const [purgeTarget, setPurgeTarget] = useState<DocumentRecord | null>(null);
    const [isUploadOpen, setUpload] = useState(false);
    const client = useQueryClient();
    const batch = useMutation({
        mutationFn: (action: string) =>
            api('/documents/batch', {
                method: 'POST',
                body: JSON.stringify({ ids: selectedDocs.map((doc) => doc.id), action }),
            }),
        onSuccess: async () => {
            setSelected([]);
            await client.invalidateQueries({ queryKey: [queryKeys.documents] });
        },
    });
    const q = params.get('q') ?? '';
    const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
    const change = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        next.delete('page');
        if (value) {
            next.set(key, value);
        } else {
            next.delete(key);
        }
        setSelected([]);
        setParams(next);
    };
    const go = (value: number) => {
        const next = new URLSearchParams(params);
        next.set('page', String(value));
        setSelected([]);
        setParams(next);
    };
    const query = useQuery({
        queryKey: [queryKeys.documents, { filters, isTrash }],
        placeholderData: keepPreviousData,
        queryFn: ({ signal }) =>
            api<Page<DocumentRecord>>(
                `/documents?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page), per_page: '12', trash: isTrash ? '1' : '0' })}`,
                { signal }
            ),
        refetchInterval: (state) =>
            state.state.data?.data.some((d) =>
                ['quarantined', 'scanning', 'extracting'].includes(d.processing_status ?? '')
            )
                ? 4000
                : false,
    });
    const restore = useMutation({
        mutationFn: (id: string) => api(`/documents/${id}/restore`, { method: 'POST' }),
        onSuccess: () => client.invalidateQueries({ queryKey: [queryKeys.documents] }),
    });
    const purge = useMutation({
        mutationFn: (id: string) => api(`/documents/${id}${isTrash ? '/purge' : ''}`, { method: 'DELETE' }),
        onSuccess: async (_, id) => {
            setPurgeTarget(null);
            setSelected((ids) => ids.filter((selectedId) => selectedId !== id));
            if (page > 1 && query.data?.data.length === 1) {
                go(page - 1);
            }
            await client.invalidateQueries({ queryKey: [queryKeys.documents] });
        },
    });
    const docs = query.data?.data ?? [];
    const total = query.data?.meta.total ?? 0;
    const currentSort = params.get('sort') ?? (q ? 'relevance' : isTrash ? 'deleted_at' : 'updated_at');
    const sortColumn = (key: string) => {
        const next = new URLSearchParams(params);
        const direction = params.get('direction') ?? 'desc';
        next.set('sort', key);
        next.set('direction', currentSort === key && direction === 'desc' ? 'asc' : 'desc');
        next.delete('page');
        setSelected([]);
        setParams(next);
    };
    const sortHeader = (label: string, key: string) => {
        const isActive = currentSort === key;
        const isAscending = (params.get('direction') ?? 'desc') === 'asc';
        return (
            <button type="button" className="table-sort" onClick={() => sortColumn(key)}>
                {label} {isActive && <span aria-hidden="true">{isAscending ? '↑' : '↓'}</span>}
            </button>
        );
    };
    const filterKeys = [...params.keys()].filter((key) => !['q', 'page', 'sort', 'direction'].includes(key));
    const isSearchFiltered = !!q || filterKeys.length > 0;
    const selectedDocs = docs.filter((doc) => selected.includes(doc.id));
    const allSelected = docs.length > 0 && selectedDocs.length === docs.length;
    return (
        <>
            <div className="page-heading">
                <div>
                    <h1>
                        {isTrash ? 'Корзина' : 'Все документы'}
                        <span className="count-pill">{total}</span>
                    </h1>
                </div>
                {!isTrash && user.role !== 'observer' && (
                    <Button onClick={() => setUpload(true)}>
                        <Plus size={18} />
                        Загрузить документ
                    </Button>
                )}
            </div>
            <section className="library-panel compact-library">
                <ErrorMessage error={batch.error} />
                <div className="list-toolbar">
                    <SearchInput
                        initialValue={q}
                        isBusy={query.isFetching}
                        onSearch={(value) => change('q', value.trim())}
                    />
                    <Popover
                        label="Фильтры"
                        trigger={
                            <>
                                <SlidersHorizontal size={16} /> Фильтры{' '}
                                {filterKeys.length > 0 && <span className="count-pill">{filterKeys.length}</span>}
                            </>
                        }
                    >
                        <div className="filter-fields">
                            <Select
                                label="Тип файла"
                                value={params.get('format') ?? ''}
                                onValueChange={(v) => change('format', v)}
                                options={[
                                    { value: '', label: 'Все типы' },
                                    ...['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg'].map(
                                        (v) => ({
                                            value: v,
                                            label: v.toUpperCase(),
                                        })
                                    ),
                                ]}
                            />
                            <Select
                                label="Статус"
                                value={params.get('status') ?? ''}
                                onValueChange={(v) => change('status', v)}
                                options={[
                                    { value: '', label: 'Все статусы' },
                                    { value: 'ready', label: 'Готово' },
                                    { value: 'quarantined', label: 'В очереди' },
                                    { value: 'scanning', label: 'Проверка' },
                                    { value: 'extracting', label: 'Распознавание' },
                                    { value: 'failed', label: 'Ошибка' },
                                    { value: 'rejected', label: 'Отклонено' },
                                ]}
                            />
                            <DateRangePicker
                                label="Дата создания"
                                from={params.get('created_from') ?? ''}
                                to={params.get('created_to') ?? ''}
                                onFromChange={(value) => change('created_from', value)}
                                onToChange={(value) => change('created_to', value)}
                            />
                            <DateRangePicker
                                label="Дата изменения"
                                from={params.get('updated_from') ?? ''}
                                to={params.get('updated_to') ?? ''}
                                onFromChange={(value) => change('updated_from', value)}
                                onToChange={(value) => change('updated_to', value)}
                            />
                            {filterKeys.length > 0 && (
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        const next = new URLSearchParams(params);
                                        filterKeys.forEach((key) => next.delete(key));
                                        next.delete('page');
                                        setSelected([]);
                                        setParams(next);
                                    }}
                                >
                                    Сбросить фильтры
                                </Button>
                            )}
                        </div>
                    </Popover>
                    <Popover
                        label="Сохранённые фильтры"
                        trigger={
                            <>
                                <BookmarkPlus size={16} /> Сохранённые фильтры
                            </>
                        }
                    >
                        {(close) => (
                            <div className="filter-fields saved-filter-list">
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
                                <Button
                                    variant="ghost"
                                    size="small"
                                    onClick={() => {
                                        setViewName('');
                                        setSaving((isOpen) => !isOpen);
                                    }}
                                >
                                    <BookmarkPlus size={15} />
                                    Сохранить фильтры
                                </Button>
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

                                        <Button
                                            type="button"
                                            size="small"
                                            variant="secondary"
                                            onClick={() => setSaving(false)}
                                        >
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
                </div>
                {selectedDocs.length > 0 && (
                    <div className="batch-toolbar" aria-label="Массовые действия">
                        <strong>Выбрано на странице: {selectedDocs.length}</strong>
                        <Button
                            variant="secondary"
                            size="small"
                            disabled={batch.isPending}
                            onClick={() => batch.mutate(isTrash ? 'restore' : 'favorite')}
                        >
                            {isTrash ? 'Восстановить' : 'В избранное'}
                        </Button>
                        {!isTrash && selectedDocs.every((doc) => doc.permissions.manage) && (
                            <Button
                                variant="destructive"
                                size="small"
                                disabled={batch.isPending}
                                onClick={() => batch.mutate('trash')}
                            >
                                В корзину
                            </Button>
                        )}
                        <Button variant="ghost" size="small" disabled={batch.isPending} onClick={() => setSelected([])}>
                            Снять выбор
                        </Button>
                    </div>
                )}
                <ErrorMessage error={query.error || restore.error} />
                <div
                    className="table-scroll library-results"
                    aria-busy={query.isFetching}
                    inert={query.isPlaceholderData}
                >
                    <DataTable className="library-table" isBusy={query.isFetching}>
                        <thead>
                            <tr>
                                <th
                                    aria-sort={
                                        currentSort === 'title'
                                            ? params.get('direction') === 'asc'
                                                ? 'ascending'
                                                : 'descending'
                                            : undefined
                                    }
                                >
                                    <span className="list-name-heading">
                                        <input
                                            type="checkbox"
                                            aria-label="Выбрать документы на этой странице"
                                            checked={allSelected}
                                            ref={(input) => {
                                                if (input) {
                                                    input.indeterminate = selectedDocs.length > 0 && !allSelected;
                                                }
                                            }}
                                            disabled={!docs.length || batch.isPending}
                                            onChange={(event) =>
                                                setSelected(event.target.checked ? docs.map((doc) => doc.id) : [])
                                            }
                                        />
                                        {sortHeader('Название документа', 'title')}
                                    </span>
                                </th>
                                <th
                                    aria-sort={
                                        params.get('sort') === 'status'
                                            ? params.get('direction') === 'asc'
                                                ? 'ascending'
                                                : 'descending'
                                            : undefined
                                    }
                                >
                                    {sortHeader('Статус', 'status')}
                                </th>
                                <th
                                    aria-sort={
                                        params.get('sort') === 'owner'
                                            ? params.get('direction') === 'asc'
                                                ? 'ascending'
                                                : 'descending'
                                            : undefined
                                    }
                                >
                                    {sortHeader('Владелец', 'owner')}
                                </th>
                                <th
                                    aria-sort={
                                        currentSort === (isTrash ? 'deleted_at' : 'updated_at')
                                            ? params.get('direction') === 'asc'
                                                ? 'ascending'
                                                : 'descending'
                                            : undefined
                                    }
                                >
                                    {isTrash
                                        ? sortHeader('В корзине с', 'deleted_at')
                                        : sortHeader('Изменён', 'updated_at')}
                                </th>
                                <th aria-label="Действия" />
                            </tr>
                        </thead>
                        <tbody>
                            {docs.map((doc) => (
                                <tr key={doc.id}>
                                    <td>
                                        <div className="document-name">
                                            <input
                                                type="checkbox"
                                                aria-label={`Выбрать ${doc.title}`}
                                                disabled={batch.isPending}
                                                checked={selected.includes(doc.id)}
                                                onChange={(e) =>
                                                    setSelected((ids) =>
                                                        e.target.checked
                                                            ? [...ids, doc.id]
                                                            : ids.filter((id) => id !== doc.id)
                                                    )
                                                }
                                            />
                                            <FileIcon mime={doc.version?.mime} name={doc.title} />
                                            <div>
                                                {isTrash ? (
                                                    <strong>{doc.title}</strong>
                                                ) : (
                                                    <Link
                                                        title={doc.title}
                                                        to={`/documents/${doc.id}`}
                                                        state={{
                                                            searchMatch: doc.search_match,
                                                            librarySearch: filters,
                                                        }}
                                                    >
                                                        <HighlightedText
                                                            text={doc.title}
                                                            match={doc.matched_title ? q.trim() : ''}
                                                        />
                                                    </Link>
                                                )}
                                                {doc.snippet && (
                                                    <p className="search-snippet">
                                                        <HighlightedText
                                                            text={doc.snippet}
                                                            match={doc.search_match?.quote ?? ''}
                                                            offset={doc.search_match?.snippet_offset}
                                                        />
                                                    </p>
                                                )}
                                                <small>
                                                    {doc.version
                                                        ? `${doc.version.original_name.split('.').at(-1)?.toUpperCase()} · ${formatBytes(doc.version.size)} · Версия ${doc.version.number}`
                                                        : 'Ожидает обработки'}
                                                </small>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <Status value={doc.processing_status ?? 'quarantined'} />
                                    </td>
                                    <td>
                                        <div className="owner-cell">
                                            <span className="avatar tiny">{doc.owner.name.slice(0, 1)}</span>
                                            <span>{doc.owner.id === user.id ? 'Вы' : doc.owner.name}</span>
                                        </div>
                                    </td>
                                    <td className="muted">{formatDate((isTrash ? doc.deleted_at : doc.updated_at) ?? null)}</td>
                                    <td>
                                        {(doc.permissions.manage ||
                                            (!isTrash &&
                                                doc.permissions.export &&
                                                doc.version?.status === 'ready')) && (
                                            <div className="row-actions">
                                                {isTrash && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={`Восстановить ${doc.title}`}
                                                        title="Восстановить"
                                                        onClick={() => restore.mutate(doc.id)}
                                                        disabled={restore.isPending}
                                                    >
                                                        <RotateCcw size={17} />
                                                    </Button>
                                                )}
                                                <Popover
                                                    label={`Действия с документом ${doc.title}`}
                                                    align="end"
                                                    trigger={<MoreHorizontal size={16} />}
                                                >
                                                    {(close) => (
                                                        <div className="menu-actions">
                                                            {!isTrash &&
                                                                doc.permissions.export &&
                                                                doc.version?.status === 'ready' && (
                                                                    <Button variant="ghost" isRenderedAsChild>
                                                                        <a
                                                                            href={`/api/v1/versions/${doc.version.id}/download`}
                                                                            onClick={close}
                                                                        >
                                                                            <Download size={15} /> Скачать
                                                                        </a>
                                                                    </Button>
                                                                )}
                                                            {doc.permissions.manage && (
                                                                <Button
                                                                    variant="destructive"
                                                                    onClick={() => {
                                                                        close();
                                                                        purge.reset();
                                                                        setPurgeTarget(doc);
                                                                    }}
                                                                >
                                                                    <Trash2 size={15} />{' '}
                                                                    {isTrash
                                                                        ? 'Удалить навсегда'
                                                                        : 'Переместить в корзину'}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </Popover>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </DataTable>
                    {query.isPending ? (
                        <TableSkeleton label="Загружаем библиотеку" />
                    ) : !docs.length && !query.isError ? (
                        <div className="empty-state">
                            <span className="empty-icon">
                                <FolderOpen size={34} />
                            </span>
                            <h3>
                                {q
                                    ? 'По запросу ничего не найдено'
                                    : isSearchFiltered
                                      ? 'Нет документов с этими фильтрами'
                                      : isTrash
                                        ? 'Корзина пуста'
                                        : 'Документы ещё не загружены'}
                            </h3>
                            {!isSearchFiltered && !isTrash && user.role !== 'observer' && (
                                <Button variant="secondary" onClick={() => setUpload(true)}>
                                    <Plus size={16} />
                                    Добавить первый документ
                                </Button>
                            )}
                        </div>
                    ) : null}
                </div>
                {query.data && (
                    <Pagination
                        label="Страницы документов"
                        page={page}
                        pages={query.data.meta.last_page}
                        onChange={go}
                        isBusy={query.isFetching || batch.isPending}
                    />
                )}
            </section>

            {purgeTarget && (
                <AlertDialog
                    title={isTrash ? 'Удалить документ навсегда?' : 'Переместить документ в корзину?'}
                    description={
                        isTrash
                            ? `Документ «${purgeTarget.title}», его версии, рабочие черновики и комментарии будут удалены без возможности восстановления.`
                            : `Документ «${purgeTarget.title}» можно будет восстановить из корзины.`
                    }
                    confirmLabel={isTrash ? 'Удалить навсегда' : 'В корзину'}
                    isBusy={purge.isPending}
                    error={purge.error}
                    onClose={() => setPurgeTarget(null)}
                    onConfirm={() => purge.mutate(purgeTarget.id)}
                />
            )}
            {isUploadOpen && <UploadPanel onClose={() => setUpload(false)} />}
        </>
    );
};
