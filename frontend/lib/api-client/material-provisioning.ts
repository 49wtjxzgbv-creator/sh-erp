import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/sales/material-provisioning.controller.ts
 * (the "Забезпечення матеріалами" stock-reservation spec, 2026-08-19).
 * Every field here is a real JSON number, not a DecimalString — like
 * customer-orders.ts's ShortageLine, this is a *computed* result
 * (MaterialProvisioningService#getItemSummary), not a raw Prisma row.
 */

export type MaterialProvisioningStatus =
  | 'NOT_COVERED'
  | 'PARTIALLY_RESERVED'
  | 'AWAITING_PURCHASE'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_COVERED'
  | 'ISSUED_TO_PRODUCTION';

export interface MaterialRequirementSummary {
  productId: string;
  /** The warehouse every quantity here is computed against — pass to getStockReservationBreakdown for the §17 drill-down. */
  warehouseId: string;
  articleSnapshot: string;
  productNameSnapshot: string;
  /** Gross BOM requirement for this order line alone — never netted against stock. */
  requiredQty: number;
  physicalQty: number;
  reservedByOthersQty: number;
  /** physicalQty - reservedByOthersQty — the ceiling this line itself can still draw from stock. */
  availableQty: number;
  reservedForThisOrderQty: number;
  reservedFromStockQty: number;
  reservedFromPurchaseQty: number;
  orderedFromSupplierQty: number;
  receivedQty: number;
  stillExpectedQty: number;
  /** Already issued to production from this line's own reservations. */
  consumedQty: number;
  /** reservedForThisOrderQty + consumedQty — the "Забезпечено X/Y" numerator. */
  coveredQty: number;
  uncoveredQty: number;
  decision: { qtyFromStock: number; qtyToPurchase: number } | null;
  status: MaterialProvisioningStatus;
}

export interface SaveMaterialProvisioningDecisionInput {
  qtyFromStock: number;
  qtyToPurchase: number;
}

export function getMaterialProvisioningSummary(orderId: string, itemId: string): Promise<MaterialRequirementSummary[]> {
  return apiClient.get<MaterialRequirementSummary[]>(`customer-orders/${orderId}/items/${itemId}/provisioning`);
}

/** Immediately reserves the stock-side delta — may reject (409) if the requested qtyFromStock exceeds what's actually available right now. */
export function saveMaterialProvisioningDecision(
  orderId: string,
  itemId: string,
  productId: string,
  dto: SaveMaterialProvisioningDecisionInput,
): Promise<MaterialRequirementSummary> {
  return apiClient.put<MaterialRequirementSummary>(`customer-orders/${orderId}/items/${itemId}/provisioning/${productId}`, dto);
}
