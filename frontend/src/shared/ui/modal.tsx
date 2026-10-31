import { useEffect, useRef, type ReactNode } from 'react';
export const Modal = ({
    children,
    titleId,
    onClose,
    busy = false,
}: {
    children: ReactNode;
    titleId: string;
    onClose: () => void;
    busy?: boolean;
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
                if (!busy) {
                    onClose();
                }
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget && !busy) {
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
