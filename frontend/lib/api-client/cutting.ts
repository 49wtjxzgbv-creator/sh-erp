import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/cutting/ (CuttingPlansController).
 * Розкрій (cutting-stock optimization, 2026-10-31) — see the backend
 * module's own header comment for the full design rationale: remnants are
 * a planning layer on top of WarehouseStock.qty, never a second ledger.
 */

export type CuttingStockKind = 'BAR' | 'SHEET';
export type CuttingPlanStatus = 'DRAFT' | 'EXECUTED';
export type CuttingPlanStockSourceKind = 'FRESH' | 'REMNANT';
export type RemnantStatus = 'AVAILABLE' | 'CONSUMED';

export interface ProductCuttingSpec {
  id: string;
  productId: string;
  kind: CuttingStockKind;
  stockLengthCm: DecimalString;
  stockWidthCm: DecimalString | null;
  kerfMm: DecimalString;
  minRemnantLengthCm: DecimalString | null;
  minRemnantAreaCm2: DecimalString | null;
  allowRotation: boolean;
}

export interface UpsertProductCuttingSpecInput {
  kind: CuttingStockKind;
  stockLengthCm: number;
  stockWidthCm?: number;
  kerfMm?: number;
  minRemnantLengthCm?: number;
  minRemnantAreaCm2?: number;
  allowRotation?: boolean;
}

export function getProductCuttingSpec(productId: string): Promise<ProductCuttingSpec | null> {
  return apiClient.get<ProductCuttingSpec | null>(`cutting/specs/${productId}`);
}

export function upsertProductCuttingSpec(productId: string, dto: UpsertProductCuttingSpecInput): Promise<ProductCuttingSpec> {
  return apiClient.put<ProductCuttingSpec>(`cutting/specs/${productId}`, dto);
}

export function deleteProductCuttingSpec(productId: string): Promise<void> {
  return apiClient.delete<void>(`cutting/specs/${productId}`);
}

export interface CuttingPlanCut {
  id: string;
  cuttingPlanStockId: string;
  productId: string;
  pieceLengthCm: DecimalString;
  pieceWidthCm: DecimalString | null;
  posXCm: DecimalString | null;
  posYCm: DecimalString | null;
  rotated: boolean;
  /** Irregular-shape nesting (2026-11-01): the piece's real contour, already placed in the sheet's own coordinate frame. Null for the ordinary rectangle path (pieceLengthCm/pieceWidthCm/posXCm/posYCm already fully describe those). */
  shapePolygonCm: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

export interface CuttingPlanStock {
  id: string;
  cuttingPlanId: string;
  productId: string;
  sourceKind: CuttingPlanStockSourceKind;
  remnantId: string | null;
  lengthCm: DecimalString;
  widthCm: DecimalString | null;
  leftoverLengthCm: DecimalString | null;
  leftoverWidthCm: DecimalString | null;
  newRemnantId: string | null;
  /** Irregular-shape nesting (2026-11-01): populated instead of leftoverLengthCm/leftoverWidthCm for a polygon-nested sheet (no clean rectangular leftover to report). */
  usedAreaCm2: DecimalString | null;
  wasteAreaCm2: DecimalString | null;
  cuts: CuttingPlanCut[];
}

export interface CuttingPlanMaterial {
  productId: string;
  product: { id: string; article: string; name: string; unitId: string } | null;
  kind: CuttingStockKind | null;
  freshUnitsNeeded: number;
  remnantsUsed: number;
  stockItems: CuttingPlanStock[];
}

export interface CuttingPlan {
  id: string;
  assemblyId: string;
  warehouseId: string;
  qty: DecimalString;
  status: CuttingPlanStatus;
  createdById: string;
  createdAt: string;
  executedAt: string | null;
  materials: CuttingPlanMaterial[];
}

export interface PreviewCuttingPlanInput {
  assemblyId: string;
  qty: number;
  warehouseId?: string;
}

export function previewCuttingPlan(dto: PreviewCuttingPlanInput): Promise<CuttingPlan> {
  return apiClient.post<CuttingPlan>('cutting/preview', dto);
}

export function executeCuttingPlan(id: string): Promise<CuttingPlan> {
  return apiClient.post<CuttingPlan>(`cutting/${id}/execute`);
}

export function getCuttingPlan(id: string): Promise<CuttingPlan> {
  return apiClient.get<CuttingPlan>(`cutting/${id}`);
}

export interface StockRemnant {
  id: string;
  productId: string;
  warehouseId: string;
  kind: CuttingStockKind;
  lengthCm: DecimalString;
  widthCm: DecimalString | null;
  code: string;
  status: RemnantStatus;
  createdAt: string;
  consumedAt: string | null;
}

export function listRemnants(filter: { productId?: string; warehouseId?: string } = {}): Promise<StockRemnant[]> {
  return apiClient.get<StockRemnant[]>('cutting/remnants', { query: filter as Record<string, string> });
}
