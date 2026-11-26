import { AlertCircle } from 'lucide-react';

export const ErrorMessage = ({ error }: { error: unknown }) => {
    if (!error) {
        return null;
    }

    return (
        <div className="error-message" role="alert">
            <AlertCircle size={17} />
            <span>
                {error instanceof Error && /[а-яё]/i.test(error.message)
                    ? error.message
                    : 'Не удалось выполнить действие. Повторите попытку.'}
            </span>
        </div>
    );
};
