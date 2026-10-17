'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPdfDocuments,
  getPdfDocumentContent,
  uploadPdfDocument,
  renamePdfDocument,
  deletePdfDocument,
} from '@/lib/api-client/pdf';

const pdfDocumentsKey = ['pdf-documents'] as const;
const pdfContentKey = (id: string) => ['pdf-documents', id, 'content'] as const;

export function usePdfDocuments() {
  return useQuery({ queryKey: pdfDocumentsKey, queryFn: () => listPdfDocuments() });
}

/** Raw bytes, cached by id — same convention as every other per-id content fetch in this app. The editor refetches explicitly after a save rather than relying on invalidation, since the bytes it already has in memory ARE the just-saved ones. */
export function usePdfDocumentContent(id: string | undefined) {
  return useQuery({
    queryKey: pdfContentKey(id ?? ''),
    queryFn: () => getPdfDocumentContent(id as string),
    enabled: Boolean(id),
    staleTime: Infinity, // immutable per fetch — a save produces a new document state the editor already holds in memory, not something to silently refetch mid-edit
  });
}

export function useUploadPdfDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, originalName, existingDocumentId }: { file: File | Blob; originalName: string; existingDocumentId?: string }) =>
      uploadPdfDocument(file, { originalName, existingDocumentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfDocumentsKey }),
  });
}

export function useRenamePdfDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renamePdfDocument(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfDocumentsKey }),
  });
}

export function useDeletePdfDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePdfDocument(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfDocumentsKey }),
  });
}
