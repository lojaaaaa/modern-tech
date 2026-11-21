import { useEffect, type RefObject } from 'react';
export const useDismiss = (ref: RefObject<HTMLElement | null>, isOpen: boolean, close: () => void) => {
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !ref.current?.contains(event.target)) {
                close();
            }
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
            }
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape);
        };
    }, [ref, isOpen, close]);
};
