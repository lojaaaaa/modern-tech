import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { api } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';
import type { DocumentRecord, Resource } from '@/shared/api/types';
import { AlertDialog } from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Modal } from '@/shared/ui/modal';
import { Popover } from '@/shared/ui/popover';
import { Select } from '@/shared/ui/select';

interface Grant {
    user_id: number;
    read: boolean;
    comment: boolean;
    edit: boolean;
    export: boolean;
}
const accessRights = { read: 'Чтение', comment: 'Комментарии', edit: 'Редактирование', export: 'Экспорт' } as const;
const accessColumns = ['read', 'comment', 'edit', 'export'] as const;
const emptyGrant: Grant = { user_id: 0, read: true, comment: false, edit: false, export: false };

export const AccessEditor = ({ id, owner }: { id: string; owner: DocumentRecord['owner'] }) => {
    const participants = useQuery({
        queryKey: [queryKeys.participants, id],
        queryFn: ({ signal }) =>
            api<Resource<{ id: number; name: string; email?: string; role: string }[]>>(
                `/documents/${id}/participants`,
                { signal }
            ),
    });
    const client = useQueryClient();
    const [mode, setMode] = useState<'add' | 'edit' | 'revoke' | null>(null);
    const [draft, setDraft] = useState(emptyGrant);
    const [search, setSearch] = useState('');
    const query = useQuery({
        queryKey: [queryKeys.grants, id],
        queryFn: ({ signal }) => api<Resource<Grant[]>>(`/documents/${id}/grants`, { signal }),
    });
    const update = useMutation({
        mutationFn: (grants: Grant[]) =>
            api(`/documents/${id}/grants`, { method: 'PUT', body: JSON.stringify({ grants }) }),
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: [queryKeys.grants, id] });
            setMode(null);
        },
    });
    const grants = query.data?.data ?? [];
    const people = participants.data?.data ?? [];
    const person = people.find((candidate) => candidate.id === draft.user_id);
    const open = (next: typeof mode, value = emptyGrant) => {
        update.reset();
        setSearch('');
        setDraft(value);
        setMode(next);
    };
    const save = () => {
        if (update.isPending || !query.data || !draft.user_id) {
            return;
        }
        const remaining = grants.filter((grant) => grant.user_id !== draft.user_id);
        update.mutate(mode === 'revoke' ? remaining : [...remaining, draft]);
    };
    return (
        <div className="access-editor">
            <header className="section-heading">
                <h2>Доступ к документу</h2>
                <Button onClick={() => open('add')} disabled={!query.data || !participants.data}>
                    Предоставить доступ
                </Button>
            </header>
            <ErrorMessage error={query.error || participants.error} />
            {query.isPending && <p role="status">Загружаем разрешения…</p>}
            <div className="table-scroll">
                <DataTable className="access-table" isBusy={query.isFetching}>
                    <thead>
                        <tr>
                            <th>Участник</th>
                            {accessColumns.map((right) => (
                                <th key={right}>{accessRights[right]}</th>
                            ))}
                            <th aria-label="Действия" />
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <strong>{owner.name}</strong>
                                <small className="block muted">Владелец · {owner.email}</small>
                            </td>
                            {accessColumns.map((right) => (
                                <td key={right}>
                                    <span aria-label="Разрешено">✓</span>
                                </td>
                            ))}
                            <td />
                        </tr>
                        {grants.map((grant) => {
                            const participant = people.find((candidate) => candidate.id === grant.user_id);
                            return (
                                <tr key={grant.user_id}>
                                    <td>
                                        <strong>{participant?.name ?? 'Участник'}</strong>
                                        <small className="block muted">{participant?.email}</small>
                                    </td>
                                    {accessColumns.map((right) => (
                                        <td key={right}>
                                            <span aria-label={grant[right] ? 'Разрешено' : 'Нет доступа'}>
                                                {grant[right] ? '✓' : '—'}
                                            </span>
                                        </td>
                                    ))}
                                    <td>
                                        <Popover
                                            label={`Действия: ${participant?.name ?? 'участник'}`}
                                            align="end"
                                            trigger={<MoreHorizontal size={16} />}
                                        >
                                            {(close) => (
                                                <div className="menu-actions">
                                                    <Button
                                                        variant="ghost"
                                                        disabled={!participant}
                                                        onClick={() => {
                                                            close();
                                                            open('edit', grant);
                                                        }}
                                                    >
                                                        Изменить разрешения
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        onClick={() => {
                                                            close();
                                                            open('revoke', grant);
                                                        }}
                                                    >
                                                        Отозвать доступ
                                                    </Button>
                                                </div>
                                            )}
                                        </Popover>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </DataTable>
            </div>
            {mode === 'revoke' && (
                <AlertDialog
                    title="Отозвать доступ?"
                    description="Участник потеряет доступ к документу."
                    confirmLabel="Отозвать доступ"
                    isBusy={update.isPending}
                    error={update.error}
                    onClose={() => setMode(null)}
                    onConfirm={save}
                />
            )}
            {(mode === 'add' || mode === 'edit') && (
                <Modal titleId="grant-dialog" onClose={() => setMode(null)} isBusy={update.isPending}>
                    <h2 id="grant-dialog">{mode === 'add' ? 'Предоставить доступ' : 'Изменить разрешения'}</h2>
                    <ErrorMessage error={update.error} />
                    <form
                        className="dialog-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            save();
                        }}
                    >
                        {mode === 'add' ? (
                            <>
                                <input
                                    aria-label="Поиск участника"
                                    placeholder="Имя или почта"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                />
                                <Select
                                    label="Участник"
                                    value={String(draft.user_id)}
                                    onValueChange={(value) => setDraft({ ...emptyGrant, user_id: Number(value) })}
                                    options={people
                                        .filter((candidate) => !grants.some((item) => item.user_id === candidate.id))
                                        .filter((candidate) =>
                                            `${candidate.name} ${candidate.email ?? ''}`
                                                .toLocaleLowerCase()
                                                .includes(search.trim().toLocaleLowerCase())
                                        )
                                        .map((candidate) => ({ value: String(candidate.id), label: candidate.name }))}
                                />
                            </>
                        ) : (
                            <strong>{person?.name}</strong>
                        )}
                        <div className="permission-fields">
                            {accessColumns.map((right) => (
                                <label key={right}>
                                    <input
                                        type="checkbox"
                                        checked={draft[right]}
                                        disabled={
                                            right === 'read' ||
                                            !person ||
                                            person.role === 'observer' ||
                                            update.isPending
                                        }
                                        onChange={(event) => setDraft({ ...draft, [right]: event.target.checked })}
                                    />
                                    {accessRights[right]}
                                </label>
                            ))}
                        </div>
                        <footer>
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={update.isPending}
                                onClick={() => setMode(null)}
                            >
                                Отмена
                            </Button>
                            <Button type="submit" disabled={update.isPending || !person}>
                                {mode === 'add' ? 'Предоставить доступ' : 'Сохранить'}
                            </Button>
                        </footer>
                    </form>
                </Modal>
            )}
        </div>
    );
};
