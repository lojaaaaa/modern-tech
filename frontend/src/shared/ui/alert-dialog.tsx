import { useId } from 'react';
import { Button } from './button';
import { ErrorMessage } from './error-message';
import { Modal } from './modal';

export const AlertDialog = ({
    title,
    description,
    confirmLabel,
    isBusy,
    error,
    onConfirm,
    onClose,
}: {
    title: string;
    description: string;
    confirmLabel: string;
    isBusy: boolean;
    error: unknown;
    onConfirm: () => void;
    onClose: () => void;
}) => {
    const titleId = useId();
    const descriptionId = useId();
    return (
        <Modal titleId={titleId} descriptionId={descriptionId} isBusy={isBusy} onClose={onClose}>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId} className="muted">
                {description}
            </p>
            <ErrorMessage error={error} />
            <footer>
                <Button type="button" autoFocus variant="secondary" disabled={isBusy} onClick={onClose}>
                    Отмена
                </Button>
                <Button type="button" variant="destructive" disabled={isBusy} onClick={onConfirm}>
                    {isBusy ? 'Выполняем…' : confirmLabel}
                </Button>
            </footer>
        </Modal>
    );
};
