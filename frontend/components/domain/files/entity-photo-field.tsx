'use client';

import { useQueryClient } from '@tanstack/react-query';
import { deleteFile, type FileDomain } from '@/lib/api-client/files';
import { useFilesForEntity } from '@/lib/hooks/use-files';
import { FileUploadField } from './file-upload-field';

/**
 * "One photo attached to an entity with no dedicated FK column" — unlike
 * `FileUploadField`'s original use case (CompanyBranding.siteLogoFileId,
 * where the caller owns a field to store/clear an id in), Product/Assembly
 * have no such column: the schema models photos purely as generic
 * `FileAsset(entityType, entityId)` rows (Phase 3 decision — see
 * FileAsset's own header comment in schema.prisma). This wrapper derives
 * "the current photo" as the newest non-deleted FileAsset for that
 * domain/entity (`listForEntity`'s own `orderBy: createdAt desc`), and
 * turns FileUploadField's "clear" action into a real soft-delete of that
 * row instead of just forgetting a reference — there is no other field
 * that would otherwise remember it.
 */
export interface EntityPhotoFieldProps {
  domain: FileDomain;
  entityType: string;
  entityId: string;
}

export function EntityPhotoField({ domain, entityType, entityId }: EntityPhotoFieldProps) {
  const qc = useQueryClient();
  const { data: files } = useFilesForEntity(entityType, entityId);
  const current = files?.[0];

  return (
    <FileUploadField
      domain={domain}
      entityType={entityType}
      entityId={entityId}
      value={current?.id}
      onChange={async (fileAssetId) => {
        if (fileAssetId === null && current) {
          await deleteFile(current.id);
        }
        qc.invalidateQueries({ queryKey: ['files', entityType, entityId] });
      }}
    />
  );
}
