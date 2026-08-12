'use client';

import { useQuery } from '@tanstack/react-query';
import { listFilesForEntity, listFilesForEntities, getFileDownloadUrl, type FileDomain } from '@/lib/api-client/files';

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

/** For list views — one batch call for every row's photos instead of one request per row. */
export function useFilesForEntities(entityType: string, entityIds: string[], domain?: FileDomain | FileDomain[]) {
  const key = [...entityIds].sort().join(',');
  return useQuery({
    queryKey: ['files-batch', entityType, key, domainKey(domain)],
    queryFn: () => listFilesForEntities(entityType, entityIds, domain),
    enabled: entityIds.length > 0,
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
