'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  listFilesForEntity,
  listFilesForEntities,
  getFileDownloadUrl,
  getFilePreview,
  deleteFile,
  type FileDomain,
  type FileAssetWithUrl,
} from '@/lib/api-client/files';

/**
 * TanStack Query hooks over lib/api-client/files.ts, following the same
 * pattern as use-catalog.ts/use-bom.ts.
 */

function domainKey(domain?: FileDomain | FileDomain[]): string {
  if (!domain) return '';
  return Array.isArray(domain) ? [...domain].sort().join(',') : domain;
}

export function useFilesForEntity(entityType: string, entityId: string | undefined, domain?: FileDomain | FileDomain[]) {
  return useQuery({
    queryKey: ['files', entityType, entityId ?? '', domainKey(domain)],
    queryFn: () => listFilesForEntity(entityType, entityId as string, domain),
    enabled: Boolean(entityId),
  });
}

const CONVERSION_POLL_INTERVAL_MS = 5000;

/** True while any file is a .step/.stp still waiting on (or mid-) server-side GLB conversion — see StepConversionService. `DONE`/`FAILED` are both terminal; `NONE` covers every non-STEP file (the vast majority), so this never triggers polling for those. */
function hasPendingStepConversion(byEntity: Record<string, FileAssetWithUrl[]> | undefined): boolean {
  if (!byEntity) return false;
  return Object.values(byEntity)
    .flat()
    .some((f) => /\.(step|stp)$/i.test(f.originalName) && (f.conversionStatus === 'NONE' || f.conversionStatus === 'PENDING'));
}

/** For list views — one batch call for every row's photos instead of one request per row. Polls every few seconds while a STEP-to-GLB conversion is still in flight, so the fast `.glb` viewer path kicks in automatically once ready without a manual refresh. */
export function useFilesForEntities(entityType: string, entityIds: string[], domain?: FileDomain | FileDomain[]) {
  const key = [...entityIds].sort().join(',');
  return useQuery({
    queryKey: ['files-batch', entityType, key, domainKey(domain)],
    queryFn: () => listFilesForEntities(entityType, entityIds, domain),
    enabled: entityIds.length > 0,
    refetchInterval: (query) => (hasPendingStepConversion(query.state.data) ? CONVERSION_POLL_INTERVAL_MS : false),
  });
}

export function useFileDownloadUrl(fileAssetId: string | undefined) {
  return useQuery({
    queryKey: ['file-download-url', fileAssetId],
    queryFn: () => getFileDownloadUrl(fileAssetId as string).then((r) => r.downloadUrl),
    enabled: Boolean(fileAssetId),
    staleTime: 50 * 60 * 1000,
  });
}

/** Only meaningful for a .xlsx attachment — pass `enabled: false` (via the `active` param) for anything else so no request fires for a PDF/image that will never call this. */
export function useFilePreview(fileAssetId: string | undefined, active: boolean) {
  return useQuery({
    queryKey: ['file-preview', fileAssetId],
    queryFn: () => getFilePreview(fileAssetId as string),
    enabled: Boolean(fileAssetId) && active,
    staleTime: 50 * 60 * 1000,
  });
}

/** Soft-deletes one file attachment. Caller is responsible for invalidating/refetching the entity's file list (its `entityType`/`entityId` aren't known here) — same "caller owns invalidation" shape as the mutation hooks in use-finance.ts. */
export function useDeleteFile() {
  return useMutation({ mutationFn: (fileAssetId: string) => deleteFile(fileAssetId) });
}
