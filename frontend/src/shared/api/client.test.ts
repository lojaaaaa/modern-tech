import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';
afterEach(() => vi.unstubAllGlobals());
describe('API boundary', () => {
    it('does not invalidate the pending session query for an anonymous visitor', async () => {
        const listener = vi.fn();
        window.addEventListener('session-expired', listener);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
        await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
        expect(listener).not.toHaveBeenCalled();
        window.removeEventListener('session-expired', listener);
    });
    it('sends CSRF token and same-origin credentials on mutations', async () => {
        document.cookie = 'XSRF-TOKEN=test-token';
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null }), { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        await api('/auth/logout', { method: 'POST' });
        expect(fetch).toHaveBeenCalledOnce();
        const init = fetch.mock.calls[0]?.[1] as RequestInit;
        expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('test-token');
        expect(init.credentials).toBe('same-origin');
    });
    it('preserves safe server errors and emits session invalidation on 401', async () => {
        const listener = vi.fn();
        window.addEventListener('session-expired', listener);
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response(JSON.stringify({ error: { message: 'Сессия истекла' } }), { status: 401 })
                )
        );
        await expect(api('/documents')).rejects.toEqual(new ApiError(401, 'Сессия истекла'));
        expect(listener).toHaveBeenCalledOnce();
        window.removeEventListener('session-expired', listener);
    });
});
