import { QueryClient } from '@tanstack/react-query';
export const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
});
