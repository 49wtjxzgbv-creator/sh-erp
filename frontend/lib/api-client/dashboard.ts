import { apiClient } from './http';

export interface DashboardSummary {
  productsCount: number;
  assembliesCount: number;
  lowStockCount: number;
  activeProductionOrders: number;
  pendingCustomerOrders: number;
  openPurchaseOrders: number;
  activeEmployees: number;
}

/** GET /dashboard/summary — cheap aggregate counts, no permission gate (every role lands here after login). */
export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiClient.get<DashboardSummary>('dashboard/summary');
}

export type TimelineStage = 'planned' | 'in_progress' | 'completed';

/** One bar on the dashboard's unified operations Gantt chart — same shape for purchase orders, production orders, and shipments (backend/src/modules/dashboard/dashboard-timeline.service.ts's TimelineLine). */
export interface TimelineLine {
  id: string;
  label: string;
  groupName: string;
  stage: TimelineStage;
  startAt: string;
  endAt: string;
}

export interface OperationsTimeline {
  from: string;
  to: string;
  purchaseOrders: TimelineLine[];
  productionOrders: TimelineLine[];
  shipments: TimelineLine[];
}

export interface OperationsTimelineQuery {
  /** ISO date. Defaults to Jan 1 of the current year. */
  from?: string;
  /** ISO date. Defaults to Dec 31 of the current year. */
  to?: string;
}

/** GET /dashboard/operations-timeline — no permission gate (same reasoning as /dashboard/summary: spans 3 modules' permission keys). */
export function getOperationsTimeline(query: OperationsTimelineQuery = {}): Promise<OperationsTimeline> {
  return apiClient.get<OperationsTimeline>('dashboard/operations-timeline', { query: query as Record<string, string> });
}
