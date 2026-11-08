import type { QueryClient } from '@tanstack/react-query';
import type { Resource, User } from '@/shared/api/types';
import { resetIdentityRequests } from '@/shared/api/client';

export const clearPrivateSession = (client: QueryClient): void => {
    resetIdentityRequests();
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    client.getMutationCache().clear();
};

export const replaceSession = (client: QueryClient, session: Resource<User> | null): void => {
    void client.cancelQueries({ queryKey: ['session'] });
    clearPrivateSession(client);
    client.setQueryData(['session'], session);
};
