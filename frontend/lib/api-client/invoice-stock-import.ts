import { apiClient } from './http';

/**
 * Typed wrappers for InvoiceStockImportController
 * (backend/src/modules/inventory/invoice-stock-import/). See that module's
 * service header comment for the fast-parser/AI-fallback design.
 */

export interface InvoiceImportMatchedRow {
  productId: string;
  article: string;
  productName: string;
  qty: number;
  rawText: string;
}

export interface InvoiceImportUnmatchedRow {
  rawName: string;
  qty: number;
}

export interface InvoiceImportPreviewResult {
  method: 'fast' | 'ai';
  matched: InvoiceImportMatchedRow[];
  unmatched: InvoiceImportUnmatchedRow[];
}

export interface ApplyInvoiceStockImportInput {
  warehouseId: string;
  lines: { productId: string; qty: number }[];
}

export interface ApplyInvoiceStockImportResult {
  applied: number;
  errors: { productId: string; message: string }[];
}

export function previewInvoiceStockImport(file: File): Promise<InvoiceImportPreviewResult> {
  return apiClient.postFile<InvoiceImportPreviewResult>('stock/invoice-import/preview', file);
}

export function applyInvoiceStockImport(input: ApplyInvoiceStockImportInput): Promise<ApplyInvoiceStockImportResult> {
  return apiClient.post<ApplyInvoiceStockImportResult>('stock/invoice-import/apply', input);
}
