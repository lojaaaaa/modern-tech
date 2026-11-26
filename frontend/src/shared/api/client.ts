export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly details: Record<string, string[]> = {}
    ) {
        super(message);
    }
}

const csrfToken = (): string => {
    const cookie = document.cookie.split('; ').find((part) => part.startsWith('XSRF-TOKEN='));

    return cookie ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) : '';
};

let identityGeneration = 0;
const identityRequests = new Set<AbortController>();
export const resetIdentityRequests = (): void => {
    identityGeneration++;
    for (const controller of identityRequests) {
        controller.abort();
    }
    identityRequests.clear();
};
export const initializeCsrf = async (): Promise<void> => {
    const response = await fetch('/sanctum/csrf-cookie', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new ApiError(response.status, 'Не удалось установить защищённую сессию.');
    }
};

const request = async <T>(path: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> => {
    const generation = identityGeneration;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    init.signal?.addEventListener('abort', cancel, { once: true });
    if (init.signal?.aborted) {
        controller.abort();
    }
    identityRequests.add(controller);
    try {
        const headers = new Headers(init.headers);
        headers.set('Accept', 'application/json');
        if (init.body && !(init.body instanceof FormData)) {
            headers.set('Content-Type', 'application/json');
        }
        if (init.method && init.method !== 'GET') {
            headers.set('X-XSRF-TOKEN', csrfToken());
        }

        const response = await fetch(`/api/v1${path}`, {
            ...init,
            signal: controller.signal,
            credentials: 'same-origin',
            cache: 'no-store',
            headers,
        });

        const current = () => {
            if (generation !== identityGeneration || controller.signal.aborted) {
                throw new DOMException('Session changed before the request completed.', 'AbortError');
            }
        };

        current();
        if (!response.ok) {
            const payload: unknown = await response.json().catch(() => null);
            current();
            const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;

            const message =
                error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
                    ? error.message
                    : 'Не удалось выполнить запрос.';

            if (response.status === 401 && path !== '/me' && path !== '/auth/login') {
                window.dispatchEvent(new Event('session-expired'));
            }

            const translated = /[а-яё]/i.test(message)
                ? message
                : ((
                      {
                          401: 'Войдите в аккаунт.',
                          403: 'Недостаточно прав для этого действия.',
                          404: 'Документ или ресурс не найден.',
                          409: 'Данные изменились. Обновите страницу и повторите действие.',
                          422: 'Проверьте введённые данные.',
                          429: 'Слишком много запросов. Попробуйте позже.',
                      } as Record<number, string>
                  )[response.status] ?? 'Не удалось выполнить запрос. Попробуйте позже.');

            throw new ApiError(response.status, translated);
        }
        const payload = await read(response);
        current();

        return payload;
    } finally {
        identityRequests.delete(controller);
        init.signal?.removeEventListener('abort', cancel);
    }
};

export const api = <T>(path: string, init: RequestInit = {}): Promise<T> =>
    request(path, init, (response) => response.json() as Promise<T>);

export const apiBlob = (path: string, init: RequestInit = {}): Promise<Blob> =>
    request(path, init, (response) => response.blob());
