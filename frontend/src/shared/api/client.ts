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
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }
    if (init.method && init.method !== 'GET') {
        headers.set('X-XSRF-TOKEN', csrfToken());
    }
    const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', headers });
    if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
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
    return response.json() as Promise<T>;
};
