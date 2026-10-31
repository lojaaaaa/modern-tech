import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, initializeCsrf, ApiError } from '@/shared/api/client';
import type { Resource, User } from '@/shared/api/types';

export const useSession = () => {
    return useQuery({
        queryKey: ['session'],
        queryFn: async ({ signal }) => {
            try {
                return await api<Resource<User>>('/me', { signal });
            } catch (error) {
                if (error instanceof ApiError && error.status === 401) {
                    return null;
                }
                throw error;
            }
        },
        retry: false,
        staleTime: 60_000,
    });
};
export const useLogin = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (values: { email: string; password: string }) => {
            await initializeCsrf();
            return api<Resource<User>>('/auth/login', { method: 'POST', body: JSON.stringify(values) });
        },
        onSuccess: (data) => {
            client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
            client.setQueryData(['session'], data);
        },
    });
};
export const useLogout = () => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => api('/auth/logout', { method: 'POST' }),
        onSuccess: () => {
            client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
            client.setQueryData(['session'], null);
        },
    });
};
