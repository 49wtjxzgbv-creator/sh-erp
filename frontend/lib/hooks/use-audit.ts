'use client';

import { useQuery } from '@tanstack/react-query';
import { queryAuditEvents, getEntityAuditHistory, type QueryAuditEventsInput } from '@/lib/api-client/audit';

export function useAuditEvents(query: QueryAuditEventsInput) {
  return useQuery({ queryKey: ['audit-events', query], queryFn: () => queryAuditEvents(query) });
}

export function useEntityAuditHistory(entityType: string, entityId: string, enabled = true) {
  return useQuery({
    queryKey: ['audit-events', 'entity', entityType, entityId],
    queryFn: () => getEntityAuditHistory(entityType, entityId),
    enabled,
  });
}
