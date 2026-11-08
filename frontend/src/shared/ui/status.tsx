import { Check, Clock3, LoaderCircle, ShieldAlert, X } from 'lucide-react';
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
            {['ready', 'completed'].includes(value) ? (
                <Check size={12} />
            ) : value === 'cancelled' ? (
                <X size={12} />
            ) : ['pending', 'quarantined'].includes(value) ? (
                <Clock3 size={12} />
            ) : ['failed', 'rejected'].includes(value) ? (
                <ShieldAlert size={12} />
            ) : (
                <LoaderCircle size={12} />
            )}
            {labels[value] ?? 'Неизвестно'}
        </span>
    );
};
