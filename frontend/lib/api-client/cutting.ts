import { apiClient } from './http';
import type { DecimalString } from './decimal';
import type { MatchedBomLine } from './ai';

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
  /** Direct-product cutting (2026-11-01): this product's own default piece-to-cut shape, used by "Порахувати розкрій" when run directly against the product (no assembly). Null means no default set yet. */
  defaultCutLengthCm: DecimalString | null;
  defaultCutWidthCm: DecimalString | null;
  defaultCutShapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

export interface UpsertProductCuttingSpecInput {
  kind: CuttingStockKind;
  stockLengthCm: number;
  stockWidthCm?: number;
  kerfMm?: number;
  minRemnantLengthCm?: number;
  minRemnantAreaCm2?: number;
  allowRotation?: boolean;
  defaultCutLengthCm?: number;
  defaultCutWidthCm?: number;
  defaultCutShapePolygon?: { outerCm: [number, number][]; holesCm: [number, number][][] };
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

/** Direct-product cutting (2026-11-01): upload a STEP file and get back candidate piece shapes for this product's own default cut shape — same extraction "Креслення → специфікація" already uses for BOM lines, reused as-is. Caller picks one line and folds its lengthCm/widthCm/shapePolygon into upsertProductCuttingSpec. */
export function extractDefaultCutShape(productId: string, fileAssetId: string): Promise<{ sourceFileAssetId: string; lines: MatchedBomLine[] }> {
  return apiClient.post<{ sourceFileAssetId: string; lines: MatchedBomLine[] }>(`cutting/specs/${productId}/extract-default-shape`, { fileAssetId });
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
  /** Null for a direct-product plan (productId set instead) — exactly one of the two is ever set. */
  assemblyId: string | null;
  /** Direct-product cutting (2026-11-01) — null for an assembly-sourced plan. */
  productId: string | null;
  warehouseId: string;
  qty: DecimalString;
  status: CuttingPlanStatus;
  createdById: string;
  createdAt: string;
  executedAt: string | null;
  materials: CuttingPlanMaterial[];
}

export interface PreviewCuttingPlanInput {
  /** Exactly one of assemblyId/productId must be set. */
  assemblyId?: string;
  productId?: string;
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

/** Direct-product cutting (2026-11-01): every product with a ProductCuttingSpec configured, enriched with draft/executed CuttingPlan counts — backs the top-level "Розкрій" list page. */
export interface CuttableProduct {
  productId: string;
  product: { id: string; article: string; name: string };
  spec: ProductCuttingSpec;
  hasDefaultShape: boolean;
  draftPlanCount: number;
  executedPlanCount: number;
  lastPlanAt: string | null;
}

export function listCuttableProducts(filter: { search?: string; limit?: number; offset?: number } = {}): Promise<{ items: CuttableProduct[]; total: number; limit: number; offset: number }> {
  return apiClient.get('cutting/products', { query: filter as unknown as Record<string, string> });
}
