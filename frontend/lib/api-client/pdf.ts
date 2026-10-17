import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/pdf/ (PdfDocumentsController) —
 * "створи пдф редактор і переглядач такий як едобе акробат" (2026-10-17).
 * PdfDocument is a company-wide library, deliberately NOT entity-scoped
 * like FileAsset — see that model's own schema comment.
 */

export interface PdfDocument {
  id: string;
  companyId: string;
  name: string;
  storageKey: string;
  sizeBytes: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreatePdfPresignedUploadInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  /** "Зберегти" on an already-open document — overwrites this row instead of creating a new library entry. */
  existingDocumentId?: string;
}

export interface PresignedPdfUpload {
  pdfDocumentId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export function listPdfDocuments(): Promise<PdfDocument[]> {
  return apiClient.get<PdfDocument[]>('pdf-documents');
}

export function createPdfPresignedUpload(dto: CreatePdfPresignedUploadInput): Promise<PresignedPdfUpload> {
  return apiClient.post<PresignedPdfUpload>('pdf-documents/presigned-upload', dto);
}

export function confirmPdfUpload(pdfDocumentId: string): Promise<PdfDocument> {
  return apiClient.post<PdfDocument>(`pdf-documents/${pdfDocumentId}/confirm`);
}

export function renamePdfDocument(pdfDocumentId: string, name: string): Promise<PdfDocument> {
  return apiClient.patch<PdfDocument>(`pdf-documents/${pdfDocumentId}`, { name });
}

export function deletePdfDocument(pdfDocumentId: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`pdf-documents/${pdfDocumentId}`);
}

/**
 * Raw PDF bytes, same-origin (see the backend's own header comment on
 * PdfDocumentsService#getContent for why this isn't a direct R2 URL) —
 * fed straight into pdfjs-dist's `getDocument({ data })` for viewing AND
 * into pdf-lib's `PDFDocument.load()` as the editing baseline, so the
 * viewer and the editor are always working from the exact same bytes.
 */
export async function getPdfDocumentContent(pdfDocumentId: string): Promise<ArrayBuffer> {
  const blob = await apiClient.getBlob(`pdf-documents/${pdfDocumentId}/content`);
  return blob.arrayBuffer();
}

/**
 * Full upload orchestration (presigned PUT + confirm), mirroring
 * lib/api-client/files.ts#uploadFile — accepts a `Blob` as well as a `File`
 * so a pdf-lib-exported `Uint8Array` (wrapped in a Blob by the caller) can
 * be saved the exact same way a freshly-picked file is.
 */
export async function uploadPdfDocument(
  file: File | Blob,
  meta: { originalName: string; existingDocumentId?: string },
): Promise<PdfDocument> {
  const mimeType = file.type || 'application/pdf';
  const presigned = await createPdfPresignedUpload({
    originalName: meta.originalName,
    mimeType,
    sizeBytes: file.size,
    existingDocumentId: meta.existingDocumentId,
  });

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload to storage failed (${putRes.status}).`);
  }

  return confirmPdfUpload(presigned.pdfDocumentId);
}
