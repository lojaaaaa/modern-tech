import { useState } from 'react';
import { Spinner } from '@/shared/ui/spinner';

export const PdfPreview = ({ url }: { url: string }) => {
    const [isReady, setReady] = useState(false);

    return (
        <div className="pdf-preview" aria-busy={!isReady}>
            {!isReady && (
                <div className="pdf-preview-loading" role="status" aria-label="Загрузка PDF">
                    <Spinner />
                </div>
            )}
            <iframe
                className="pdf-reader"
                title="Предпросмотр PDF"
                src={`${url}#view=Fit&navpanes=0`}
                style={{ visibility: isReady ? 'visible' : 'hidden' }}
                onLoad={() => setReady(true)}
            />
        </div>
    );
};
