import { ErrorMessage } from '@/shared/ui/error-message';
import { PageLoader } from '@/shared/ui/spinner';
import type { useDocumentWorkspace } from '../model/useDocumentWorkspace';

type Props = Pick<ReturnType<typeof useDocumentWorkspace>, 'id' | 'entities'>;
export const DocumentEntities = ({ entities }: Props) => (
    <div className="access-editor">
        <p>
            Сущности определяются по простым правилам: даты, email, суммы и некоторые названия российских организаций.
            Возможны пропуски и ложные совпадения; результат не является полноценным распознаванием имён и организаций.
        </p>
        <ErrorMessage error={entities.error} />
        {entities.isPending ? (
            <PageLoader />
        ) : entities.data?.data.length ? (
            Array.from(
                entities.data.data
                    .reduce((groups, entity) => {
                        const key =
                            entity.type +
                            ':' +
                            entity.value
                                .toLocaleLowerCase()
                                .replace(/[«»“”"]/g, '')
                                .replace(/\s+/g, ' ')
                                .trim();

                        const existing = groups.get(key);
                        if (existing) {
                            existing.count++;
                        } else {
                            groups.set(key, { ...entity, count: 1 });
                        }

                        return groups;
                    }, new Map<string, { id: number; type: string; value: string; count: number }>())
                    .values()
            ).map((entity) => (
                <div className="grant-row" key={entity.id}>
                    <small>
                        {(
                            {
                                date: 'Дата',
                                email: 'Email',
                                amount: 'Сумма',
                                organization: 'Организация',
                            } as Record<string, string>
                        )[entity.type] ?? 'Данные'}
                    </small>
                    <span>{entity.value}</span>
                    {entity.count > 1 && <span className="count-pill">{entity.count}</span>}
                </div>
            ))
        ) : (
            <p className="muted">Данные не найдены. Для ранее загруженных документов требуется повторная обработка.</p>
        )}
    </div>
);
