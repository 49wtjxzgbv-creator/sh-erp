import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/legacy-import/ — the universal
 * import platform (connections to external data sources via a pluggable
 * provider, e.g. Google Apps Script today, plus jobs run against a
 * connection). See that module's provider.interface.ts for the backend
 * abstraction this UI reflects.
 */

export interface ImportProvider {
  type: string;
  displayName: string;
}

export type ImportConnectionStatus = 'PENDING' | 'PAIRED' | 'REVOKED';

export interface ConnectorHealthDiagnostic {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ConnectorHealth {
  reachable: boolean;
  protocolVersion?: string;
  protocolSupported: boolean;
  providerVersion?: string;
  capabilities: string[];
  diagnostics: ConnectorHealthDiagnostic[];
  checkedAt: string;
}

export interface ImportConnection {
  id: string;
  companyId: string;
  providerType: string;
  label: string;
  status: ImportConnectionStatus;
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  protocolVersion: string | null;
  connectorVersion: string | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: ConnectorHealth | null;
  createdByUserId: string;
  createdAt: string;
  pairedAt: string | null;
  revokedAt: string | null;
}

export interface EntityReportLine {
  entity: string;
  total: number;
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  failed?: number;
}

export interface ReportConflict {
  entity: string;
  description: string;
}

export interface ReportIssue {
  step: string;
  message: string;
}

export interface ImportReport {
  protocolVersion?: string;
  connectorVersion?: string;
  entities: EntityReportLine[];
  conflicts: ReportConflict[];
  warnings: ReportIssue[];
  errors: ReportIssue[];
  photosDiscovered: number;
  photosMissing?: number;
  durationMs?: number;
  loadedCounts?: Record<string, number>;
  skippedLedgers?: string[];
}

export type ImportJobStatus =
  | 'PENDING' | 'FETCHING' | 'TRANSFORMING' | 'LOADING' | 'IMPORTING_PHOTOS' | 'VERIFYING' | 'COMPLETED' | 'FAILED';

export interface ImportJob {
  id: string;
  companyId: string;
  connectionId: string;
  status: ImportJobStatus;
  step: string | null;
  dryRun: boolean;
  totalPhotos: number | null;
  processedPhotos: number;
  warnings: ReportIssue[] | null;
  errors: ReportIssue[] | null;
  report: ImportReport | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

export function listImportProviders(): Promise<ImportProvider[]> {
  return apiClient.get<ImportProvider[]>('legacy-import/providers');
}

export function listConnections(): Promise<ImportConnection[]> {
  return apiClient.get<ImportConnection[]>('legacy-import/connections');
}

export function startConnection(input: { providerType: string; label?: string }): Promise<ImportConnection> {
  return apiClient.post<ImportConnection>('legacy-import/connections', input);
}

export function getConnection(id: string): Promise<ImportConnection> {
  return apiClient.get<ImportConnection>(`legacy-import/connections/${id}`);
}

export function healthCheckConnection(id: string): Promise<ConnectorHealth> {
  return apiClient.post<ConnectorHealth>(`legacy-import/connections/${id}/health-check`);
}

export function revokeConnection(id: string): Promise<ImportConnection> {
  return apiClient.post<ImportConnection>(`legacy-import/connections/${id}/revoke`);
}

export function reconnectConnection(id: string): Promise<ImportConnection> {
  return apiClient.post<ImportConnection>(`legacy-import/connections/${id}/reconnect`);
}

export function validateImport(connectionId: string): Promise<ImportReport> {
  return apiClient.post<ImportReport>('legacy-import/validate', { connectionId });
}

export function startImport(input: { connectionId: string; dryRun?: boolean }): Promise<ImportJob> {
  return apiClient.post<ImportJob>('legacy-import/jobs', input);
}

export function getImportJob(id: string): Promise<ImportJob> {
  return apiClient.get<ImportJob>(`legacy-import/jobs/${id}`);
}

export function listImportJobs(connectionId?: string): Promise<ImportJob[]> {
  return apiClient.get<ImportJob[]>('legacy-import/jobs', { query: connectionId ? { connectionId } : undefined });
}
