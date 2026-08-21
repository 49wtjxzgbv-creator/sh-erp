import { supplierPortalApi } from './api';

/**
 * Cross-company by nature (2026-08-21 P0, ADR-0012 — multi-company
 * redesign) — plain Bearer-authenticated calls through the existing
 * `supplierPortalApi` client, same as the purchase-orders list. No session-
 * store involvement: accepting/declining doesn't change which company is
 * currently active, it only changes what shows up in the selector.
 */
export interface SupplierPortalConnection {
  id: string;
  companyId: string;
  companyName: string;
  status: 'ACTIVE' | 'PENDING';
  invitedAt: string;
}

export function listConnections(): Promise<SupplierPortalConnection[]> {
  return supplierPortalApi.get<SupplierPortalConnection[]>('supplier-portal/connections');
}

export function acceptConnection(connectionId: string): Promise<SupplierPortalConnection> {
  return supplierPortalApi.post<SupplierPortalConnection>(`supplier-portal/connections/${connectionId}/accept`);
}

export function declineConnection(connectionId: string): Promise<{ id: string; status: string }> {
  return supplierPortalApi.post<{ id: string; status: string }>(`supplier-portal/connections/${connectionId}/decline`);
}
