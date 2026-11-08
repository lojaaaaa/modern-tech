import { CalendarDays } from 'lucide-react';
import { DatePicker } from '@/shared/ui/date-picker';
import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus,
    X,
    FileText,
    Image as ImageIcon,
    BookmarkPlus,
    ArrowUpRight,
    ArrowLeft,
    ArrowRight,
    RotateCcw,
    FolderOpen,
} from 'lucide-react';
import { api } from '@/shared/api/client';
import type { DocumentRecord, Page, User } from '@/shared/api/types';
import { Select } from '@/shared/ui/select';
import { SearchInput } from '@/shared/ui/search-input';
import { Button } from '@/shared/ui/button';
import { Status } from '@/shared/ui/status';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes, formatDate } from '@/shared/lib/utils';
import { UploadPanel } from '@/features/upload';
export const LibraryPage = ({ user, trash = false }: { user: User; trash?: boolean }) => {
    useEffect(() => {
        const close = (event: PointerEvent) => {
            document
                .querySelectorAll<HTMLDetailsElement>('details.date-filters[open], details.batch-actions-menu[open]')
                .forEach((details) => {
                    if (event.target instanceof Node && !details.contains(event.target)) {
                        details.open = false;
                    }
                });
        };
        document.addEventListener('pointerdown', close, true);
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                document.querySelectorAll<HTMLDetailsElement>('details.batch-actions-menu[open]').forEach((details) => {
                    details.open = false;
                    details.querySelector('summary')?.focus();
                });
            }
        };
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', close, true);
            document.removeEventListener('keydown', escape);
        };
    }, []);
    const [params, setParams] = useSearchParams();
    const viewsKey = `library-views:${user.id}:${trash}`;
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
    const [saving, setSaving] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [upload, setUpload] = useState(false);
    const client = useQueryClient();
    const batch = useMutation({
        mutationFn: (action: string) =>
            api('/documents/batch', { method: 'POST', body: JSON.stringify({ ids: selected, action }) }),
        onSuccess: async () => {
            setSelected([]);
            await client.invalidateQueries({ queryKey: ['documents'] });
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
    const filters = params.toString();
    const query = useQuery({
        queryKey: ['documents', { filters, trash }],
        queryFn: ({ signal }) =>
            api<Page<DocumentRecord>>(
                `/documents?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page), per_page: '12', trash: trash ? '1' : '0' })}`,
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
        onSuccess: () => client.invalidateQueries({ queryKey: ['documents'] }),
    });
    const docs = query.data?.data ?? [];
    const total = query.data?.meta.total ?? 0;
    const sortColumn = (key: string) => {
        const next = new URLSearchParams(params);
        const current = params.get('sort') ?? 'updated_at';
        const direction = params.get('direction') ?? 'desc';
        next.set('sort', key);
        next.set('direction', current === key && direction === 'desc' ? 'asc' : 'desc');
        next.delete('page');
        setSelected([]);
        setParams(next);
    };
    const sortHeader = (label: string, key: string) => {
        const active = (params.get('sort') ?? 'updated_at') === key;
        const ascending = (params.get('direction') ?? 'desc') === 'asc';
        return (
            <button type="button" className="table-sort" onClick={() => sortColumn(key)}>
                {label} {active && <span aria-hidden="true">{ascending ? '↑' : '↓'}</span>}
            </button>
        );
    };
    const hasSearchFilters = [...params.keys()].some((key) => !['page', 'sort', 'direction'].includes(key));
    return (
        <>
            <div className="page-heading">
                <div>
                    <div className="breadcrumbs">
                        Библиотека <span>/</span> {trash ? 'Корзина' : 'Документы'}
                    </div>
                    <h1>
                        {trash ? 'Корзина' : 'Все документы'}
                        <span className="count-pill">{total}</span>
                    </h1>
                </div>
                {!trash && user.role !== 'observer' && (
                    <Button
                        disabled={user.email_verified_at === null}
                        title={user.email_verified_at === null ? 'Сначала подтвердите электронную почту' : undefined}
                        onClick={() => setUpload(true)}
                    >
                        <Plus size={18} />
                        Загрузить документ
                    </Button>
                )}
            </div>
            <section className="library-panel compact-library">
                <ErrorMessage error={batch.error} />
                <div className="saved-views">
                    {views.map((view, i) => (
                        <span key={view.name}>
                            <Button variant="ghost" size="small" onClick={() => setParams(view.query)}>
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
                    <Button variant="ghost" size="small" onClick={() => setSaving(!saving)}>
                        <BookmarkPlus size={15} />
                        Сохранить фильтры
                    </Button>
                    {saving && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!viewName.trim()) {
                                    return;
                                }
                                const next = [
                                    ...views.filter((v) => v.name !== viewName.trim()),
                                    { name: viewName.trim(), query: params.toString() },
                                ].slice(-10);
                                setViews(next);
                                localStorage.setItem(viewsKey, JSON.stringify(next));
                                setSaving(false);
                                setViewName('');
                            }}
                        >
                            <input
                                aria-label="Название представления"
                                maxLength={40}
                                value={viewName}
                                onChange={(e) => setViewName(e.target.value)}
                                placeholder="Например, договоры за месяц"
                            />
                            <Button size="small">Сохранить</Button>
                        </form>
                    )}
                </div>
                <div className="library-toolbar">
                    <SearchInput initialValue={q} busy={query.isFetching} onSearch={(value) => change('q', value)} />
                </div>
                <div className="library-filters">
                    <div className="selection-actions">
                        <details key={selected.join(',')} className="batch-actions-menu">
                            <summary>Действия{selected.length > 0 ? ` · ${selected.length}` : ''}</summary>
                            <div>
                                <Button
                                    variant="ghost"
                                    disabled={!selected.length || batch.isPending}
                                    onClick={() => batch.mutate(trash ? 'restore' : 'favorite')}
                                >
                                    {trash ? 'Восстановить' : 'В избранное'}
                                </Button>
                                {!trash && (
                                    <Button
                                        variant="ghost"
                                        disabled={!selected.length || batch.isPending}
                                        onClick={() => batch.mutate('trash')}
                                    >
                                        В корзину
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    disabled={!selected.length || batch.isPending}
                                    onClick={() => setSelected([])}
                                >
                                    Снять выбор
                                </Button>
                            </div>
                        </details>
                    </div>
                    <Select
                        label="Тип файла"
                        value={params.get('format') ?? ''}
                        onValueChange={(v) => change('format', v)}
                        options={[
                            { value: '', label: 'Все типы' },
                            ...['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg'].map((v) => ({
                                value: v,
                                label: v.toUpperCase(),
                            })),
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
                    <details className="date-filters">
                        <summary>
                            <CalendarDays size={15} />
                            Даты
                        </summary>
                        <div>
                            {' '}
                            <label>
                                Создан с
                                <DatePicker
                                    label="created_from"
                                    value={params.get('created_from') ?? ''}
                                    onChange={(value) => change('created_from', value)}
                                />
                            </label>
                            <label>
                                Создан по
                                <DatePicker
                                    label="created_to"
                                    value={params.get('created_to') ?? ''}
                                    onChange={(value) => change('created_to', value)}
                                />
                            </label>
                            <label>
                                Изменён с
                                <DatePicker
                                    label="updated_from"
                                    value={params.get('updated_from') ?? ''}
                                    onChange={(value) => change('updated_from', value)}
                                />
                            </label>
                            <label>
                                Изменён по
                                <DatePicker
                                    label="updated_to"
                                    value={params.get('updated_to') ?? ''}
                                    onChange={(value) => change('updated_to', value)}
                                />
                            </label>
                        </div>
                    </details>
                </div>
                <ErrorMessage error={query.error || restore.error} />
                <div className="table-scroll">
                    <table className="documents-table library-table">
                        <thead>
                            <tr>
                                <th
                                    aria-sort={
                                        (params.get('sort') ?? 'updated_at') === 'title'
                                            ? params.get('direction') === 'asc'
                                                ? 'ascending'
                                                : 'descending'
                                            : undefined
                                    }
                                >
                                    {sortHeader('Название документа', 'title')}
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
                                        (params.get('sort') ?? 'updated_at') === 'updated_at'
                                            ? params.get('direction') === 'asc'
                                                ? 'ascending'
                                                : 'descending'
                                            : undefined
                                    }
                                >
                                    {sortHeader('Изменён', 'updated_at')}
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
                                                checked={selected.includes(doc.id)}
                                                onChange={(e) =>
                                                    setSelected((ids) =>
                                                        e.target.checked
                                                            ? [...ids, doc.id]
                                                            : ids.filter((id) => id !== doc.id)
                                                    )
                                                }
                                            />
                                            <span
                                                className={`file-icon ${doc.version?.mime.startsWith('image/') ? 'purple' : doc.version?.mime.includes('pdf') ? 'red' : 'blue'}`}
                                            >
                                                {doc.version?.mime.startsWith('image/') ? (
                                                    <ImageIcon size={22} />
                                                ) : (
                                                    <FileText size={23} />
                                                )}
                                            </span>
                                            <div>
                                                {trash ? (
                                                    <strong>{doc.title}</strong>
                                                ) : (
                                                    <Link title={doc.title} to={`/documents/${doc.id}`}>
                                                        {doc.title}
                                                    </Link>
                                                )}
                                                {doc.snippet && <p className="search-snippet">…{doc.snippet}…</p>}
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
                                    <td className="muted">{formatDate(doc.updated_at)}</td>
                                    <td>
                                        {trash ? (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={`Восстановить ${doc.title}`}
                                                onClick={() => restore.mutate(doc.id)}
                                                disabled={restore.isPending}
                                            >
                                                <RotateCcw size={17} />
                                            </Button>
                                        ) : (
                                            <Link
                                                className="row-link"
                                                to={`/documents/${doc.id}`}
                                                aria-label={`Открыть ${doc.title}`}
                                            >
                                                <ArrowUpRight size={17} />
                                            </Link>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {query.isPending ? (
                    <div className="empty-state">
                        <div className="loading-orbit" />
                        <h3>Загружаем библиотеку</h3>
                    </div>
                ) : !docs.length && !query.isError ? (
                    <div className="empty-state">
                        <span className="empty-icon">
                            <FolderOpen size={34} />
                        </span>
                        <h3>
                            {hasSearchFilters
                                ? 'Нет документов по этим условиям'
                                : trash
                                  ? 'В корзине пусто'
                                  : 'Нет документов'}
                        </h3>
                        {hasSearchFilters && (
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setSelected([]);
                                    setParams({});
                                }}
                            >
                                Сбросить поиск и фильтры
                            </Button>
                        )}
                        {!q && !trash && user.role !== 'observer' && (
                            <Button variant="secondary" onClick={() => setUpload(true)}>
                                <Plus size={16} />
                                Добавить первый документ
                            </Button>
                        )}
                    </div>
                ) : null}
                <div className="table-footer">
                    <span>{total ? `Показано ${docs.length} из ${total}` : 'Нет документов'}</span>
                    <div>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Предыдущая страница"
                            disabled={page <= 1}
                            onClick={() => go(page - 1)}
                        >
                            <ArrowLeft size={16} />
                        </Button>
                        <span>
                            Страница {page} из {query.data?.meta.last_page ?? 1}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Следующая страница"
                            disabled={page >= (query.data?.meta.last_page ?? 1)}
                            onClick={() => go(page + 1)}
                        >
                            <ArrowRight size={16} />
                        </Button>
                    </div>
                </div>
            </section>
            {upload && <UploadPanel onClose={() => setUpload(false)} />}
        </>
    );
};
