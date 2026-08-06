'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  validateImport,
  startImport,
  getImportJob,
  listImportJobs,
  type StartImportInput,
} from '@/lib/api-client/legacy-import';

const jobsKey = ['legacy-import-jobs'] as const;
const jobKey = (id: string) => ['legacy-import-job', id] as const;

/** Wizard step 2 — no cache/query key needed, it's a one-shot action, not cached data. */
export function useValidateImport() {
  return useMutation({ mutationFn: (input: StartImportInput) => validateImport(input) });
}

export function useStartImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartImportInput) => startImport(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobsKey }),
  });
}

/** Polled every 2s while the job is still running — stops once it reaches a terminal status, same "polled DB status" pattern as PendingAiAction elsewhere in this app. */
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

export function useImportJobs() {
  return useQuery({ queryKey: jobsKey, queryFn: listImportJobs });
}
