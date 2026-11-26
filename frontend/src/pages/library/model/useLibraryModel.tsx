import { api } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';
import type { DocumentRecord, Page, User } from '@/shared/api/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export const useLibraryModel = ({ user, isTrash = false }: { user: User; isTrash?: boolean }) => {
    const [params, setParams] = useSearchParams();
    const filters = params.toString();
    const viewsKey = `library-views:${user.id}:${isTrash}`;

    const [selection, setSelection] = useState<{ filters: string; ids: string[] }>({ filters, ids: [] });
    const selected = selection.filters === filters ? selection.ids : [];

    const setSelected = (next: string[] | ((ids: string[]) => string[])) => {
        setSelection((previous) => ({
            filters,
            ids: typeof next === 'function' ? next(previous.filters === filters ? previous.ids : []) : next,
        }));
    };

    const [isBatchTrashOpen, setBatchTrashOpen] = useState(false);
    const [purgeTarget, setPurgeTarget] = useState<DocumentRecord | null>(null);
    const [isUploadOpen, setUpload] = useState(false);
    const client = useQueryClient();

    const batch = useMutation({
        mutationFn: (action: 'restore' | 'trash') =>
            api('/documents/batch', {
                method: 'POST',
                body: JSON.stringify({ ids: selectedDocs.map((doc) => doc.id), action }),
            }),
        onSuccess: async () => {
            setBatchTrashOpen(false);
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
                `/documents?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page), per_page: '10', trash: isTrash ? '1' : '0' })}`,
                { signal }
            ),
        refetchInterval: (state) =>
            state.state.data?.data.some((d) =>
                ['quarantined', 'scanning', 'extracting'].includes(d.processing_status ?? '')
            )
                ? 4000
                : false,
    });

    const lastPage = query.isPlaceholderData ? undefined : query.data?.meta.last_page;
    useEffect(() => {
        if (lastPage === undefined || page <= Math.max(1, lastPage)) {
            return;
        }
        const next = new URLSearchParams(params);
        const target = Math.max(1, lastPage);
        if (target === 1) {
            next.delete('page');
        } else {
            next.set('page', String(target));
        }
        setParams(next, { replace: true });
    }, [lastPage, page, params, setParams]);

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
    const selectableDocs = docs.filter((doc) => doc.permissions.manage);
    const selectedDocs = selectableDocs.filter((doc) => selected.includes(doc.id));
    const allSelected = selectableDocs.length > 0 && selectedDocs.length === selectableDocs.length;

    return {
        params,
        setParams,
        filters,
        viewsKey,

        selection,
        setSelection,
        selected,
        setSelected,
        isBatchTrashOpen,
        setBatchTrashOpen,
        purgeTarget,
        setPurgeTarget,
        isUploadOpen,
        setUpload,
        client,
        batch,
        q,
        page,
        change,
        go,
        query,
        lastPage,
        restore,
        purge,
        docs,
        total,
        currentSort,
        sortColumn,
        sortHeader,
        filterKeys,
        isSearchFiltered,
        selectableDocs,
        selectedDocs,
        allSelected,
        user,
        isTrash,
    };
};
