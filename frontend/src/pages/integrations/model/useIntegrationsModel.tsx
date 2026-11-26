import { api, ApiError } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';
import type { CloudConnection, CloudTransfer, RemoteFile, Resource } from '@/shared/api/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export const useIntegrationsModel = () => {
    const operationKeys = useRef(new Map<string, string>());
    const client = useQueryClient();
    const [params, setParams] = useSearchParams();
    const authorizationResult = params.get('google');

    const [selected, setSelected] = useState(() =>
        authorizationResult === 'connected' ? (params.get('connection') ?? '') : ''
    );

    const [path, setPath] = useState('/');

    const [provider, setProvider] = useState<'google' | 'mail'>(() =>
        params.has('google') || params.get('provider') === 'google'
            ? 'google'
            : params.get('provider') === 'mail'
              ? 'mail'
              : 'google'
    );

    const [isConnectOpen, setConnectOpen] = useState(() => params.get('connect') === '1');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const connections = useQuery({
        queryKey: [queryKeys.connections],
        queryFn: ({ signal }) => api<Resource<CloudConnection[]>>('/connections', { signal }),
    });

    const authorization = useQuery({
        queryKey: ['cloud-authorization', provider],
        queryFn: ({ signal }) =>
            api<Resource<{ available: boolean }>>(`/connections/${provider}/authorization`, { signal }),
        enabled: provider !== 'mail',
    });

    const connectGoogle = useMutation({
        mutationFn: (connectionId?: string) =>
            api<Resource<{ url: string }>>(`/connections/${provider}/authorization`, {
                method: 'POST',
                body: JSON.stringify(connectionId ? { connection_id: connectionId } : {}),
            }),
        onSuccess: (result) => window.location.assign(result.data.url),
    });

    const files = useQuery({
        queryKey: [queryKeys.remoteFiles, selected, path],
        queryFn: async ({ signal }) => {
            try {
                return await api<Resource<RemoteFile[]>>(
                    `/connections/${selected}/files?${new URLSearchParams({ path })}`,
                    { signal }
                );
            } catch (error) {
                if (error instanceof ApiError && error.status === 422) {
                    void client.invalidateQueries({ queryKey: [queryKeys.connections] });
                }
                throw error;
            }
        },
        enabled: connections.data?.data.some((c) => c.id === selected && c.status === 'connected') ?? false,
        retry: false,
    });

    const transfers = useQuery({
        queryKey: [queryKeys.transfers],
        queryFn: ({ signal }) => api<Resource<CloudTransfer[]>>('/transfers', { signal }),
        refetchInterval: (q) =>
            q.state.data?.data.some((t) => ['queued', 'running'].includes(t.status)) ? 3000 : false,
    });

    const create = useMutation({
        mutationFn: () =>
            api('/connections', {
                method: 'POST',
                body: JSON.stringify({
                    provider: 'mail',
                    name,
                    email,
                    password,
                }),
            }),
        onSuccess: async () => {
            setPassword('');
            setName('');
            setConnectOpen(false);
            await client.invalidateQueries({ queryKey: [queryKeys.connections] });
        },
    });

    const disconnect = useMutation({
        mutationFn: (id: string) => api(`/connections/${id}`, { method: 'DELETE' }),
        onSuccess: async () => {
            setSelected('');
            client.removeQueries({ queryKey: [queryKeys.remoteFiles] });
            await client.invalidateQueries({ queryKey: [queryKeys.connections] });
            await client.invalidateQueries({ queryKey: [queryKeys.transfers] });
        },
    });

    const importFile = useMutation({
        mutationFn: (file: RemoteFile) => {
            const scope = selected + ':' + file.path;
            if (!operationKeys.current.has(scope)) {
                operationKeys.current.set(scope, crypto.randomUUID());
            }

            return api('/transfers', {
                headers: { 'Idempotency-Key': operationKeys.current.get(scope) ?? '' },
                method: 'POST',
                body: JSON.stringify({
                    connection_id: selected,
                    direction: 'import',
                    path: file.path,
                    filename: file.name,
                }),
            });
        },
        onSuccess: () => {
            operationKeys.current.clear();

            return client.invalidateQueries({ queryKey: [queryKeys.transfers] });
        },
    });

    const cancel = useMutation({
        mutationFn: (id: string) => api(`/transfers/${id}`, { method: 'DELETE' }),
        onSuccess: () => client.invalidateQueries({ queryKey: [queryKeys.transfers] }),
    });

    const providerConnections = connections.data?.data.filter((c) => c.provider === provider) ?? [];

    const providerTransfers =
        transfers.data?.data.filter((t) => providerConnections.some((c) => c.id === t.connection_id)) ?? [];

    const chooseProvider = (service: 'google' | 'mail') => {
        setProvider(service);
        setSelected('');
        setPath('/');
        setPassword('');
        create.reset();
        connectGoogle.reset();
    };

    const closeConnect = () => {
        setPassword('');
        setConnectOpen(false);
        if (params.has('connect')) {
            const next = new URLSearchParams(params);
            next.delete('connect');
            setParams(next, { replace: true });
        }
    };

    return {
        operationKeys,
        client,
        params,
        setParams,
        authorizationResult,
        selected,
        setSelected,
        path,
        setPath,
        provider,
        setProvider,
        isConnectOpen,
        setConnectOpen,
        name,
        setName,
        email,
        setEmail,
        password,
        setPassword,
        connections,
        authorization,
        connectGoogle,
        files,
        transfers,
        create,
        disconnect,
        importFile,
        cancel,
        providerConnections,
        providerTransfers,
        chooseProvider,
        closeConnect,
    };
};
