'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { previewInvoiceStockImport, applyInvoiceStockImport } from '@/lib/api-client/invoice-stock-import';

/** Read-only recognition step — no cache to invalidate. */
export function usePreviewInvoiceStockImport() {
  return useMutation({ mutationFn: (file: File) => previewInvoiceStockImport(file) });
}

/** Same `['stock-levels']`/`['stock-history']` invalidation every other stock-mutating hook in use-inventory.ts performs. */
export function useApplyInvoiceStockImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: applyInvoiceStockImport,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-history'] });
    },
  });
}
