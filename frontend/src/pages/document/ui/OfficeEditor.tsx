import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Button } from '@/shared/ui/button';

type EditorInstance = { destroyEditor: () => void };
type OfficeWindow = Window & {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => EditorInstance };
};
type EditorSession = { documentServerUrl: string; config: Record<string, unknown> };

let scriptPromise: Promise<void> | undefined;
let scriptUrl: string | undefined;
let loadingScript: HTMLScriptElement | undefined;

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
        loadingScript = script;
        script.src = url.href;
        script.onload = () => {
            loadingScript = undefined;
            resolve();
        };
        script.onerror = () => {
            script.remove();
            loadingScript = undefined;
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
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState('Подключаем редактор…');
    const [elementId] = useState(() => `office-editor-${crypto.randomUUID()}`);

    useEffect(() => {
        const controller = new AbortController();
        let editor: EditorInstance | undefined;
        let disposed = false;
        let failed = false;
        const timeout = window.setTimeout(() => {
            if (disposed || failed) {
                return;
            }
            failed = true;
            controller.abort();
            if (loadingScript) {
                loadingScript.remove();
                loadingScript = undefined;
                scriptPromise = undefined;
                scriptUrl = undefined;
            }
            editor?.destroyEditor();
            setStatus('Редактор недоступен');
            setError(new Error('Редактор не ответил. Проверьте подключение к серверу и попробуйте снова.'));
        }, 30000);
        const open = async () => {
            try {
                const session = await api<EditorSession>(`/documents/${documentId}/editor/session`, {
                    method: 'POST',
                    signal: controller.signal,
                });
                await loadEditor(session.documentServerUrl);
                if (disposed || failed) {
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
                            if (!disposed && !failed) {
                                window.clearTimeout(timeout);
                                setStatus('Редактор подключён');
                            }
                        },
                        onError: () => {
                            if (!disposed && !failed) {
                                window.clearTimeout(timeout);
                                failed = true;
                                setError(
                                    new Error('Редактор сообщил об ошибке. Проверьте соединение и попробуйте снова.')
                                );
                                setStatus('Ошибка редактора. Проверьте соединение.');
                            }
                        },
                    },
                });
            } catch (cause) {
                if (!disposed && !failed) {
                    window.clearTimeout(timeout);
                    setError(cause);
                    setStatus('Редактор недоступен');
                }
            }
        };
        void open();
        return () => {
            disposed = true;
            window.clearTimeout(timeout);
            controller.abort();
            editor?.destroyEditor();
        };
    }, [documentId, elementId, attempt]);

    return (
        <div className="office-editor">
            <p role="status" className="muted">
                {status}
            </p>
            <p className="muted">
                Комментарии доступны в панели редактора слева. Для сохранения черновика закройте редактор у всех
                участников.
            </p>
            <ErrorMessage error={error} />
            {error !== null && (
                <Button
                    variant="secondary"
                    onClick={() => {
                        setError(null);
                        setStatus('Подключаем редактор…');
                        setAttempt((value) => value + 1);
                    }}
                >
                    Повторить подключение
                </Button>
            )}
            <div id={elementId} className="office-editor-frame" />
        </div>
    );
};
