import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/legacy-import/ (LegacyImportController)
 * — the SHСклад import wizard's backend. See that module's header comments
 * for the fetch -> transform -> load -> report pipeline this drives.
 */

export interface StartImportInput {
  sourceUrl: string;
  sourceToken: string;
  dryRun?: boolean;
}

export interface ImportReportCounts {
  newUnits: number;
  products: number;
  productsExcluded: number;
  suppliers: number;
  warehouses: number;
  warehouseStock: number;
  assemblies: number;
  assemblyComponents: number;
  assemblyVersions: number;
  customerOrders: number;
  customerOrderItems: number;
  stockMovements: number;
  auditEvents: number;
  photosDiscovered: number;
}

export interface ImportReport {
  counts: ImportReportCounts;
  warningCount: number;
  loadedCounts?: Record<string, number>;
  skippedLedgers?: string[];
}

export interface ValidateImportResult {
  report: ImportReport;
  warnings: { step: string; message: string }[];
}

export type ImportJobStatus =
  | 'PENDING' | 'FETCHING' | 'TRANSFORMING' | 'LOADING' | 'IMPORTING_PHOTOS' | 'VERIFYING' | 'COMPLETED' | 'FAILED';

export interface ImportJob {
  id: string;
  companyId: string;
  status: ImportJobStatus;
  step: string | null;
  sourceUrl: string;
  dryRun: boolean;
  totalPhotos: number | null;
  processedPhotos: number;
  warnings: { step: string; message: string }[] | null;
  report: ImportReport | null;
  errorMessage: string | null;
  startedByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

export function validateImport(input: StartImportInput): Promise<ValidateImportResult> {
  return apiClient.post<ValidateImportResult>('legacy-import/validate', input);
}

export function startImport(input: StartImportInput): Promise<ImportJob> {
  return apiClient.post<ImportJob>('legacy-import/jobs', input);
}

export function getImportJob(id: string): Promise<ImportJob> {
  return apiClient.get<ImportJob>(`legacy-import/jobs/${id}`);
}

export function listImportJobs(): Promise<ImportJob[]> {
  return apiClient.get<ImportJob[]>('legacy-import/jobs');
}
