import { LoaderCircle } from 'lucide-react';

export const Spinner = () => <LoaderCircle className="ui-spinner" size={20} aria-hidden="true" />;

export const PageLoader = ({ isFullPage = false }: { isFullPage?: boolean }) => (
    <div className={isFullPage ? 'app-loading' : 'empty-state'} role="status" aria-label="Загрузка страницы">
        <Spinner />
    </div>
);
