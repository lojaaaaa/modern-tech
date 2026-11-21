import { queryKeys } from '@/shared/api/query-keys';
import type { QueryClient } from '@tanstack/react-query';
import type { Resource, User } from '@/shared/api/types';
import { resetIdentityRequests } from '@/shared/api/client';

export const clearPrivateSession = (client: QueryClient): void => {
    resetIdentityRequests();
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.session });
    client.getMutationCache().clear();
};

export const replaceSession = (client: QueryClient, session: Resource<User> | null): void => {
    void client.cancelQueries({ queryKey: [queryKeys.session] });
    clearPrivateSession(client);
    client.setQueryData([queryKeys.session], session);
};
