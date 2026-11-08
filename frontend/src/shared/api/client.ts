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
export const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
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
            throw new ApiError(response.status, message);
        }
        const payload = (await response.json()) as T;
        current();
        return payload;
    } finally {
        identityRequests.delete(controller);
        init.signal?.removeEventListener('abort', cancel);
    }
};
