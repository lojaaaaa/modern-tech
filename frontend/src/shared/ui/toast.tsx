import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

export const Toast = () => {
    const [message, setMessage] = useState('');
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;

        const show = (event: Event) => {
            setMessage((event as CustomEvent<string>).detail);
            clearTimeout(timer);
            timer = setTimeout(() => setMessage(''), 8000);
        };

        window.addEventListener('app-notice', show);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('app-notice', show);
        };
    }, []);

    return message ? (
        <div className="app-toast" role="status">
            <span>{message}</span>
            <Button variant="ghost" size="icon" aria-label="Закрыть уведомление" onClick={() => setMessage('')}>
                <X size={16} />
            </Button>
        </div>
    ) : null;
};
