import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/files/ (FilesController). Files
 * are never proxied through either Next.js or the NestJS API (Phase 2 §7)
 * — the browser PUTs directly to R2 using a short-lived presigned URL, so
 * `uploadFile()` below is a 3-step orchestration (presign → direct PUT →
 * confirm), not a single API call.
 */

export type FileDomain =
  | 'PRODUCT_PHOTO'
  | 'PRODUCT_DOCUMENT'
  | 'ASSEMBLY_PHOTO'
  | 'ASSEMBLY_DRAWING'
  | 'ASSEMBLY_DOCUMENT'
  | 'CUSTOMER_ORDER_DOCUMENT'
  | 'PURCHASE_INVOICE'
  | 'EMPLOYEE_PHOTO'
  | 'QC_PHOTO'
  | 'SHIPMENT_PHOTO'
  | 'BRANDING'
  | 'FINANCE_DOCUMENT';

export type FileConversionStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED';

export interface FileAsset {
  id: string;
  companyId: string;
  domain: FileDomain;
  entityType: string;
  entityId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isPublic: boolean;
  uploadedById: string | null;
  /** Set for .step/.stp uploads only — see backend's StepConversionService. NONE for every other file. */
  conversionStatus: FileConversionStatus;
  createdAt: string;
  deletedAt: string | null;
}

interface CreatePresignedUploadInput {
  domain: FileDomain;
  entityType: string;
  entityId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isPublic?: boolean;
}

interface PresignedUpload {
  fileAssetId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

function createPresignedUpload(dto: CreatePresignedUploadInput): Promise<PresignedUpload> {
  return apiClient.post<PresignedUpload>('files/presigned-upload', dto);
}

function confirmUpload(fileAssetId: string): Promise<FileAsset> {
  return apiClient.post<FileAsset>(`files/${fileAssetId}/confirm`);
}

export function getFileDownloadUrl(fileAssetId: string): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  return apiClient.get(`files/${fileAssetId}/download-url`);
}

export interface FilePreviewSheet {
  name: string;
  rows: (string | number | null)[][];
  truncatedRows: boolean;
  truncatedCols: boolean;
}

export interface FilePreview {
  sheets: FilePreviewSheet[];
  truncatedSheets: boolean;
}

/** Server-side parsed preview (rows/cells as JSON) — only available for .xlsx attachments, see files.service.ts#getSpreadsheetPreview's header comment for why this is the one file type proxied through the API. */
export function getFilePreview(fileAssetId: string): Promise<FilePreview> {
  return apiClient.get(`files/${fileAssetId}/preview`);
}

/** `domain` narrows to one or more `FileDomain`s (e.g. only `PRODUCT_PHOTO`, excluding `PRODUCT_DOCUMENT`) — omit to list every file on the entity regardless of domain. */
export function listFilesForEntity(entityType: string, entityId: string, domain?: FileDomain | FileDomain[]): Promise<FileAsset[]> {
  return apiClient.get<FileAsset[]>('files', { query: { entityType, entityId, ...domainQuery(domain) } });
}

/** `FileAsset` plus a presigned download URL — only the batch endpoint returns this (see files.service.ts#listForEntities's header comment for why: signing locally, in one server-side pass, is what actually avoids an N+1 for a list view's worth of thumbnails). */
export interface FileAssetWithUrl extends FileAsset {
  downloadUrl: string;
  /** Presigned URL for the converted .glb — only present when `conversionStatus === 'DONE'`. */
  convertedDownloadUrl?: string;
}

/** Batch counterpart used by list views (e.g. a product grid's thumbnail column) to avoid one request per row. */
export function listFilesForEntities(
  entityType: string,
  entityIds: string[],
  domain?: FileDomain | FileDomain[],
): Promise<Record<string, FileAssetWithUrl[]>> {
  if (entityIds.length === 0) return Promise.resolve({});
  return apiClient.get<Record<string, FileAssetWithUrl[]>>('files/batch', {
    query: { entityType, entityIds: entityIds.join(','), ...domainQuery(domain) },
  });
}

function domainQuery(domain?: FileDomain | FileDomain[]): { domain?: string } {
  if (!domain) return {};
  return { domain: Array.isArray(domain) ? domain.join(',') : domain };
}

export function deleteFile(fileAssetId: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`files/${fileAssetId}`);
}

/**
 * Full upload orchestration used by every "attach a file" UI in the app
 * (components/domain/files/file-upload-field.tsx is the shared widget built
 * on top of this). Throws if the direct-to-R2 PUT fails, leaving an
 * unconfirmed FileAsset row behind — acceptable since confirmUpload never
 * ran, so it never shows up in listFilesForEntity's normal query path, and
 * cleaning up orphaned unconfirmed rows is a housekeeping job, not
 * something the upload flow itself needs to handle synchronously.
 */
export async function uploadFile(
  file: File,
  meta: { domain: FileDomain; entityType: string; entityId: string; isPublic?: boolean },
): Promise<FileAsset> {
  const presigned = await createPresignedUpload({
    domain: meta.domain,
    entityType: meta.entityType,
    entityId: meta.entityId,
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    isPublic: meta.isPublic,
  });

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload to storage failed (${putRes.status}).`);
  }

  return confirmUpload(presigned.fileAssetId);
}
