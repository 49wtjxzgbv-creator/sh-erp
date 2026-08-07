'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listImportProviders,
  listConnections,
  startConnection,
  getConnection,
  healthCheckConnection,
  revokeConnection,
  reconnectConnection,
  validateImport,
  startImport,
  getImportJob,
  listImportJobs,
} from '@/lib/api-client/legacy-import';

const connectionsKey = ['legacy-import-connections'] as const;
const connectionKey = (id: string) => ['legacy-import-connection', id] as const;
const jobsKey = (connectionId?: string) => ['legacy-import-jobs', connectionId ?? 'all'] as const;
const jobKey = (id: string) => ['legacy-import-job', id] as const;

export function useImportProviders() {
  return useQuery({ queryKey: ['legacy-import-providers'], queryFn: listImportProviders });
}

export function useConnections() {
  return useQuery({ queryKey: connectionsKey, queryFn: listConnections });
}

/** Polled while PENDING (waiting for pairing) — stops once PAIRED/REVOKED, same shape as useImportJob's polling. */
export function useConnection(id: string | undefined) {
  return useQuery({
    queryKey: connectionKey(id ?? ''),
    queryFn: () => getConnection(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 2000 : false),
  });
}

export function useStartConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { providerType: string; label?: string }) => startConnection(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionsKey }),
  });
}

export function useHealthCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => healthCheckConnection(connectionId),
    onSuccess: (_data, connectionId) => {
      queryClient.invalidateQueries({ queryKey: connectionKey(connectionId) });
      queryClient.invalidateQueries({ queryKey: connectionsKey });
    },
  });
}

export function useRevokeConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => revokeConnection(connectionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionsKey }),
  });
}

export function useReconnectConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => reconnectConnection(connectionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionsKey }),
  });
}

export function useValidateImport() {
  return useMutation({ mutationFn: (connectionId: string) => validateImport(connectionId) });
}

export function useStartImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { connectionId: string; dryRun?: boolean }) => startImport(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobsKey() }),
  });
}

/** Polled every 2s while the job is still running — stops once it reaches a terminal status. */
export function useImportJob(id: string | undefined) {
  return useQuery({
    queryKey: jobKey(id ?? ''),
    queryFn: () => getImportJob(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const terminal = status === 'COMPLETED' || status === 'FAILED';
      return terminal ? false : 2000;
    },
  });
}

export function useImportJobs(connectionId?: string) {
  return useQuery({ queryKey: jobsKey(connectionId), queryFn: () => listImportJobs(connectionId) });
}
