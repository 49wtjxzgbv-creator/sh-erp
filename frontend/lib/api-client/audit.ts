import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/audit/audit.controller.ts (path
 * `audit-events`, NOT `audit` — the controller's own @Controller decorator).
 * `AuditService.record()` has been called from nearly every mutation across
 * every module since Module 2, but until this production-readiness pass
 * nothing in the frontend ever queried it back — this is that missing
 * viewer. Requires `audit:read`.
 */

export interface AuditEvent {
  id: string;
  companyId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface QueryAuditEventsInput {
  entityType?: string;
  action?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface QueryAuditEventsResult {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export function queryAuditEvents(query: QueryAuditEventsInput = {}): Promise<QueryAuditEventsResult> {
  return apiClient.get<QueryAuditEventsResult>('audit-events', { query: query as Record<string, string | number> });
}

export function getEntityAuditHistory(entityType: string, entityId: string): Promise<AuditEvent[]> {
  return apiClient.get<AuditEvent[]>(`audit-events/entity/${entityType}/${entityId}`);
}
