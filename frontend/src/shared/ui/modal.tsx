import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
export const Modal = ({
    children,
    titleId,
    onClose,
    isBusy = false,
    closeLabel = 'Закрыть окно',
    descriptionId,
}: {
    children: ReactNode;
    titleId: string;
    onClose: () => void;
    isBusy?: boolean;
    closeLabel?: string;
    descriptionId?: string;
}) => {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current;
        dialog?.showModal();
        return () => dialog?.close();
    }, []);
    return (
        <dialog
            ref={ref}
            className="modal"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            role={descriptionId ? 'alertdialog' : undefined}
            onCancel={(e) => {
                e.preventDefault();
                if (!isBusy) {
                    onClose();
                }
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget && !isBusy) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (
                        e.clientX < rect.left ||
                        e.clientX > rect.right ||
                        e.clientY < rect.top ||
                        e.clientY > rect.bottom
                    ) {
                        onClose();
                    }
                }
            }}
        >
            <Button
                variant="ghost"
                size="icon"
                type="button"
                className="modal-close"
                aria-label={closeLabel}
                disabled={isBusy}
                onClick={onClose}
            >
                <X size={17} />
            </Button>
            {children}
        </dialog>
    );
};
