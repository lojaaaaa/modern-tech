import { api, ApiError } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';
import type { DocumentRecord, Resource } from '@/shared/api/types';
import { ActionMenu } from '@/shared/ui/action-menu';
import { AlertDialog } from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Modal } from '@/shared/ui/modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ParticipantSelect } from './ParticipantSelect';

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
                `/documents/${id}/participants?granted=1`,
                { signal }
            ),
    });

    const client = useQueryClient();
    const [mode, setMode] = useState<'add' | 'edit' | 'revoke' | null>(null);

    const [selectedPerson, setSelectedPerson] = useState<{
        id: number;
        name: string;
        email?: string;
        role: string;
    } | null>(null);

    const [draft, setDraft] = useState(emptyGrant);
    const [revision, setRevision] = useState<number | null>(null);

    const query = useQuery({
        queryKey: [queryKeys.grants, id],
        queryFn: ({ signal }) =>
            api<Resource<Grant[]> & { meta: { revision: number; owner_permissions: Record<string, boolean> } }>(
                `/documents/${id}/grants`,
                { signal }
            ),
    });

    const update = useMutation({
        mutationFn: (grants: Grant[]) =>
            api(`/documents/${id}/grants`, {
                method: 'PUT',
                body: JSON.stringify({ grants, revision }),
            }),
        onError: (error) => {
            if (error instanceof ApiError && error.status === 409) {
                void client.invalidateQueries({ queryKey: [queryKeys.grants, id] });
            }
        },
        onSuccess: async () => {
            await client.invalidateQueries({ queryKey: [queryKeys.grants, id] });
            setMode(null);
        },
    });

    const grants = query.data?.data ?? [];
    const people = participants.data?.data ?? [];
    const person = selectedPerson ?? people.find((candidate) => candidate.id === draft.user_id);

    const open = (next: typeof mode, value = emptyGrant) => {
        update.reset();
        setSelectedPerson(null);
        setDraft(value);
        setRevision(query.data?.meta.revision ?? null);
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
                                    <span
                                        aria-label={
                                            query.data?.meta.owner_permissions?.[right] === false
                                                ? 'Нет доступа'
                                                : 'Разрешено'
                                        }
                                    >
                                        {query.data?.meta.owner_permissions?.[right] === false ? '—' : '✓'}
                                    </span>
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
                                        <ActionMenu label={`Действия: ${participant?.name ?? 'участник'}`}>
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
                                        </ActionMenu>
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
                            <ParticipantSelect
                                documentId={id}
                                excluded={grants.map((grant) => grant.user_id)}
                                onSelect={(person) => {
                                    setSelectedPerson(person);
                                    setDraft({ ...emptyGrant, user_id: person?.id ?? 0 });
                                }}
                            />
                        ) : (
                            <strong>{person?.name}</strong>
                        )}
                        <p className="field-hint muted" role="status">
                            {!person
                                ? 'Выберите сотрудника из списка, чтобы настроить разрешения.'
                                : person.role === 'observer'
                                  ? 'Наблюдателю доступно только чтение. Остальные разрешения ограничены его ролью.'
                                  : 'Чтение обязательно. Остальные разрешения можно включать независимо.'}
                        </p>
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
                                        onChange={(event) =>
                                            setDraft((current) => ({ ...current, [right]: event.target.checked }))
                                        }
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
