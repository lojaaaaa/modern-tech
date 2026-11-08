import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, initializeCsrf, ApiError } from '@/shared/api/client';
import type { Resource, User, RegistrationInput } from '@/shared/api/types';
import type { components, operations } from '@/shared/api/schema';
import { clearPrivateSession, replaceSession } from './transition';
export { replaceSession } from './transition';

export const useSession = () => {
    const client = useQueryClient();
    return useQuery({
        queryKey: ['session'],
        queryFn: async ({ signal }) => {
            let session: Resource<User> | null;
            try {
                session = await api<Resource<User>>('/me', { signal });
            } catch (error) {
                if (error instanceof ApiError && error.status === 401) {
                    session = null;
                } else {
                    throw error;
                }
            }
            const previous = client.getQueryData<Resource<User> | null>(['session']);
            if (previous?.data.id && previous.data.id !== session?.data.id) {
                clearPrivateSession(client);
            }
            return session;
        },
        retry: false,
        staleTime: 60_000,
    });
};
export const useLogin = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (values: components['schemas']['LoginRequest']) => {
            await initializeCsrf();
            return api<Resource<User>>('/auth/login', { method: 'POST', body: JSON.stringify(values) });
        },
        onSuccess: (data) => {
            replaceSession(client, data);
        },
    });
};
export const useLogout = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => api('/auth/logout', { method: 'POST' }),
        onSuccess: () => {
            replaceSession(client, null);
        },
    });
};

export const useRegister = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (values: RegistrationInput) => {
            await initializeCsrf();
            return api<Resource<User>>('/auth/register', { method: 'POST', body: JSON.stringify(values) });
        },
        onSuccess: (data) => {
            replaceSession(client, data);
        },
    });
};

export const useResendVerification = () =>
    useMutation({
        mutationFn: () =>
            api<operations['emailVerification.store']['responses'][202]['content']['application/json']>(
                '/auth/verification-notification',
                { method: 'POST' }
            ),
    });
