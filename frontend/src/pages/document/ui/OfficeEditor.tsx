import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';
import { ErrorMessage } from '@/shared/ui/error-message';

type EditorInstance = { destroyEditor: () => void };
type OfficeWindow = Window & {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => EditorInstance };
};
type EditorSession = { documentServerUrl: string; config: Record<string, unknown> };

let scriptPromise: Promise<void> | undefined;
let scriptUrl: string | undefined;

const loadEditor = (baseUrl: string): Promise<void> => {
    const url = new URL('web-apps/apps/api/documents/api.js', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        return Promise.reject(new Error('Недопустимый адрес редактора.'));
    }
    if (scriptPromise && scriptUrl === url.href) {
        return scriptPromise;
    }
    if (scriptPromise) {
        return Promise.reject(new Error('Адрес редактора изменился. Обновите страницу.'));
    }
    scriptUrl = url.href;
    scriptPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url.href;
        script.onload = () => resolve();
        script.onerror = () => {
            script.remove();
            scriptPromise = undefined;
            scriptUrl = undefined;
            reject(new Error('Не удалось подключить редактор.'));
        };
        document.head.appendChild(script);
    });
    return scriptPromise;
};

export const OfficeEditor = ({ documentId }: { documentId: string }) => {
    const [error, setError] = useState<unknown>(null);
    const [status, setStatus] = useState('Подключаем редактор…');
    const [elementId] = useState(() => `office-editor-${crypto.randomUUID()}`);

    useEffect(() => {
        const controller = new AbortController();
        let editor: EditorInstance | undefined;
        let disposed = false;
        const open = async () => {
            try {
                const session = await api<EditorSession>(`/documents/${documentId}/editor/session`, {
                    method: 'POST',
                    signal: controller.signal,
                });
                await loadEditor(session.documentServerUrl);
                if (disposed) {
                    return;
                }
                const DocsAPI = (window as OfficeWindow).DocsAPI;
                if (!DocsAPI) {
                    throw new Error('Редактор не загрузился.');
                }
                editor = new DocsAPI.DocEditor(elementId, {
                    ...session.config,
                    events: {
                        onDocumentReady: () => {
                            if (!disposed) {
                                setStatus('Редактор подключён');
                            }
                        },
                        onError: () => {
                            if (!disposed) {
                                setStatus('Ошибка редактора. Проверьте соединение.');
                            }
                        },
                    },
                });
            } catch (cause) {
                if (!disposed) {
                    setError(cause);
                    setStatus('Редактор недоступен');
                }
            }
        };
        void open();
        return () => {
            disposed = true;
            controller.abort();
            editor?.destroyEditor();
        };
    }, [documentId, elementId]);

    return (
        <div className="office-editor">
            <p role="status" className="muted">
                {status}
            </p>
            <ErrorMessage error={error} />
            <div id={elementId} className="office-editor-frame" />
        </div>
    );
};
