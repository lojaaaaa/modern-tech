import { api } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Spinner } from '@/shared/ui/spinner';
import { useEffect, useState } from 'react';

type EditorInstance = { destroyEditor: () => void };
type OfficeWindow = Window & {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => EditorInstance };
};
type EditorSession = { documentServerUrl: string; config: Record<string, unknown> };

let scriptPromise: Promise<void> | undefined;
let scriptUrl: string | undefined;
let loadingScript: HTMLScriptElement | undefined;

const loadEditor = (baseUrl: string): Promise<void> => {
    const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, window.location.origin);
    const url = new URL('web-apps/apps/api/documents/api.js', base);
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
    const [isLoading, setLoading] = useState(true);
    const [elementId] = useState(() => `office-editor-${crypto.randomUUID()}`);

    useEffect(() => {
        // The proxied editor shares this origin. Its stored theme overrides uiTheme.
        try {
            localStorage.setItem('ui-theme-id', 'theme-white');
            localStorage.setItem('content-theme', 'light');
        } catch {
            // The server configuration still supplies the theme when storage is unavailable.
        }
        const controller = new AbortController();
        let editor: EditorInstance | undefined;
        let isDisposed = false;
        let isFailed = false;

        const timeout = window.setTimeout(() => {
            if (isDisposed || isFailed) {
                return;
            }
            isFailed = true;
            controller.abort();
            if (loadingScript) {
                loadingScript.remove();
                loadingScript = undefined;
                scriptPromise = undefined;
                scriptUrl = undefined;
            }
            editor?.destroyEditor();
            setLoading(false);
            setError(new Error('Редактор не ответил. Проверьте подключение к серверу и попробуйте снова.'));
        }, 30000);

        const open = async () => {
            try {
                const session = await api<EditorSession>(`/documents/${documentId}/editor/session`, {
                    method: 'POST',
                    signal: controller.signal,
                    body: JSON.stringify({ dark: false }),
                });

                await loadEditor(session.documentServerUrl);
                if (isDisposed || isFailed) {
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
                            if (!isDisposed && !isFailed) {
                                window.clearTimeout(timeout);
                                setLoading(false);
                            }
                        },
                        onError: () => {
                            if (!isDisposed && !isFailed) {
                                window.clearTimeout(timeout);
                                isFailed = true;
                                setError(
                                    new Error('Редактор сообщил об ошибке. Проверьте соединение и попробуйте снова.')
                                );
                                setLoading(false);
                            }
                        },
                    },
                });
            } catch (cause) {
                if (!isDisposed && !isFailed) {
                    window.clearTimeout(timeout);
                    setError(cause);
                    setLoading(false);
                }
            }
        };

        void open();

        return () => {
            isDisposed = true;
            window.clearTimeout(timeout);
            controller.abort();
            editor?.destroyEditor();
        };
    }, [documentId, elementId, attempt]);

    return (
        <div className="office-editor" aria-busy={isLoading}>
            {isLoading && (
                <div className="office-editor-loading" role="status" aria-label="Загрузка редактора">
                    <Spinner />
                </div>
            )}
            <ErrorMessage error={error} />
            {error !== null && (
                <Button
                    variant="secondary"
                    onClick={() => {
                        setError(null);
                        setLoading(true);
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
