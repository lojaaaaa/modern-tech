import { Check, LoaderCircle, ShieldAlert } from 'lucide-react';
const labels: Record<string, string> = {
    ready: 'Готово',
    pending: 'Ожидание',
    running: 'Выполняется',
    completed: 'Завершено',
    recognizing: 'Распознавание',
    indexing: 'Индексация',
    quarantined: 'В очереди',
    scanning: 'Проверка',
    extracting: 'Распознавание',
    failed: 'Ошибка',
    rejected: 'Отклонён',
    cancelled: 'Отменён',
};
export const Status = ({ value }: { value: string }) => {
    return (
        <span className={`status status-${value}`}>
            {value === 'ready' ? (
                <Check size={12} />
            ) : ['failed', 'rejected'].includes(value) ? (
                <ShieldAlert size={12} />
            ) : (
                <LoaderCircle size={12} />
            )}
            {labels[value] ?? 'Неизвестно'}
        </span>
    );
};
