import { useEffect, useRef, type ReactNode } from 'react';
export const Modal = ({
    children,
    titleId,
    onClose,
    isBusy = false,
}: {
    children: ReactNode;
    titleId: string;
    onClose: () => void;
    isBusy?: boolean;
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
            {children}
        </dialog>
    );
};
