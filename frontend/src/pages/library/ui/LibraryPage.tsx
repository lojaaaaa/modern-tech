import { UploadPanel } from '@/features/upload';
import type { User } from '@/shared/api/types';
import { AlertDialog } from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { TableSkeleton, TableToolbar, TableViewport } from '@/shared/ui/data-table';
import { DateRangePicker } from '@/shared/ui/date-range-picker';
import { ErrorMessage } from '@/shared/ui/error-message';
import { FilterOptions, FilterPopover } from '@/shared/ui/filter-popover';
import { Pagination } from '@/shared/ui/pagination';
import { SearchInput } from '@/shared/ui/search-input';
import { SelectionToolbar } from '@/shared/ui/selection-toolbar';
import { FolderOpen, Plus } from 'lucide-react';
import { useLibraryModel } from '../model/useLibraryModel';
import { LibraryTable } from './LibraryTable';
import { SavedFilters } from './SavedFilters';

export const LibraryPage = ({ user, isTrash = false }: { user: User; isTrash?: boolean }) => {
    const {
        params,
        setParams,
        filters,
        viewsKey,
        selected,
        setSelected,
        isBatchTrashOpen,
        setBatchTrashOpen,
        purgeTarget,
        setPurgeTarget,
        isUploadOpen,
        setUpload,
        batch,
        q,
        page,
        change,
        go,
        query,
        restore,
        purge,
        docs,
        total,
        currentSort,
        sortHeader,
        filterKeys,
        isSearchFiltered,
        selectableDocs,
        selectedDocs,
        allSelected,
    } = useLibraryModel({ user, isTrash });

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
                <TableToolbar label="Поиск и фильтры документов">
                    <SearchInput
                        initialValue={q}
                        isBusy={query.isFetching}
                        onSearch={(value) => change('q', value.trim())}
                    />
                    <FilterPopover
                        count={filterKeys.length}
                        onReset={() => {
                            const next = new URLSearchParams(params);
                            filterKeys.forEach((key) => next.delete(key));
                            next.delete('page');
                            setSelected([]);
                            setParams(next);
                        }}
                    >
                        <FilterOptions
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
                        <FilterOptions
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
                    </FilterPopover>
                    <SavedFilters
                        key={viewsKey}
                        params={params}
                        setParams={setParams}
                        filters={filters}
                        viewsKey={viewsKey}
                        setSelected={setSelected}
                        page={page}
                        query={query}
                    />
                </TableToolbar>
                {selectedDocs.length > 0 && (
                    <SelectionToolbar
                        count={selectedDocs.length}
                        isBusy={batch.isPending}
                        onClear={() => setSelected([])}
                    >
                        <Button
                            variant={isTrash ? 'secondary' : 'destructive'}
                            size="small"
                            disabled={batch.isPending}
                            onClick={() => {
                                if (isTrash) {
                                    batch.mutate('restore');
                                } else {
                                    setBatchTrashOpen(true);
                                }
                            }}
                        >
                            {isTrash ? 'Восстановить' : 'В корзину'}
                        </Button>
                    </SelectionToolbar>
                )}
                <ErrorMessage error={query.error || restore.error} />
                <TableViewport className="library-results" isPlaceholderData={query.isPlaceholderData}>
                    <LibraryTable
                        params={params}
                        filters={filters}
                        selected={selected}
                        setSelected={setSelected}
                        setPurgeTarget={setPurgeTarget}
                        batch={batch}
                        q={q}
                        query={query}
                        restore={restore}
                        purge={purge}
                        docs={docs}
                        currentSort={currentSort}
                        sortHeader={sortHeader}
                        selectableDocs={selectableDocs}
                        selectedDocs={selectedDocs}
                        allSelected={allSelected}
                        user={user}
                        isTrash={isTrash}
                    />
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
                </TableViewport>
                {query.data && (
                    <Pagination
                        label="Страницы документов"
                        page={page}
                        pages={query.data.meta.last_page}
                        count={query.data.meta.total}
                        onChange={go}
                        isBusy={query.isFetching || batch.isPending}
                    />
                )}
            </section>

            {isBatchTrashOpen && (
                <AlertDialog
                    title="Переместить выбранные документы в корзину?"
                    description={`Выбрано документов: ${selectedDocs.length}. Их можно будет восстановить.`}
                    confirmLabel="В корзину"
                    isBusy={batch.isPending}
                    error={batch.error}
                    onClose={() => setBatchTrashOpen(false)}
                    onConfirm={() => batch.mutate('trash')}
                />
            )}
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
