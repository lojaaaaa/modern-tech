import { formatBytes, formatDate } from '@/shared/lib/utils';
import { ActionMenu } from '@/shared/ui/action-menu';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { FileIcon } from '@/shared/ui/file-icon';
import { HighlightedText } from '@/shared/ui/highlighted-text';
import { Status } from '@/shared/ui/status';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { useLibraryModel } from '../model/useLibraryModel';

type Props = Pick<
    ReturnType<typeof useLibraryModel>,
    | 'params'
    | 'filters'
    | 'selected'
    | 'setSelected'
    | 'setPurgeTarget'
    | 'batch'
    | 'q'
    | 'query'
    | 'restore'
    | 'purge'
    | 'docs'
    | 'currentSort'
    | 'sortHeader'
    | 'selectableDocs'
    | 'selectedDocs'
    | 'allSelected'
    | 'user'
    | 'isTrash'
>;
export const LibraryTable = ({
    params,
    filters,
    selected,
    setSelected,
    setPurgeTarget,
    batch,
    q,
    query,
    restore,
    purge,
    docs,
    currentSort,
    sortHeader,
    selectableDocs,
    selectedDocs,
    allSelected,
    user,
    isTrash,
}: Props) => (
    <DataTable className={isTrash ? 'library-table trash-table' : 'library-table'} isBusy={query.isFetching}>
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
                            disabled={!selectableDocs.length || batch.isPending}
                            onChange={(event) =>
                                setSelected(event.target.checked ? selectableDocs.map((doc) => doc.id) : [])
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
                    {isTrash ? sortHeader('В корзине с', 'deleted_at') : sortHeader('Изменён', 'updated_at')}
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
                                disabled={!doc.permissions.manage || batch.isPending}
                                checked={selected.includes(doc.id)}
                                onChange={(e) =>
                                    setSelected((ids) =>
                                        e.target.checked ? [...ids, doc.id] : ids.filter((id) => id !== doc.id)
                                    )
                                }
                            />
                            <FileIcon mime={doc.version?.mime} name={doc.version?.original_name ?? doc.title} />
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
                                        <HighlightedText text={doc.title} match={doc.matched_title ? q.trim() : ''} />
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
                            (!isTrash && doc.permissions.export && doc.version?.status === 'ready')) && (
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
                                <ActionMenu label={`Действия с документом ${doc.title}`}>
                                    {(close) => (
                                        <div className="menu-actions">
                                            {!isTrash && doc.permissions.export && doc.version?.status === 'ready' && (
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
                                                    {isTrash ? 'Удалить навсегда' : 'Переместить в корзину'}
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </ActionMenu>
                            </div>
                        )}
                    </td>
                </tr>
            ))}
        </tbody>
    </DataTable>
);
