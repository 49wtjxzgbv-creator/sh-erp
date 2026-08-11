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
