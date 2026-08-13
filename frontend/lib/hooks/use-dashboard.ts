'use client';

import { useQuery } from '@tanstack/react-query';
import { getDashboardSummary, getOperationsTimeline, type OperationsTimelineQuery } from '@/lib/api-client/dashboard';

export function useDashboardSummary() {
  return useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => getDashboardSummary() });
}

export function useOperationsTimeline(query: OperationsTimelineQuery) {
  return useQuery({ queryKey: ['dashboard', 'operations-timeline', query], queryFn: () => getOperationsTimeline(query) });
}
