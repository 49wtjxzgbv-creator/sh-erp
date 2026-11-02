import { supplierPortalApi } from '@/lib/supplier-portal/api';
import type { CuttingStockKind } from './cutting';

/**
 * "розкрій має могти робити постачальник сам собі" (2026-11-02) — the
 * supplier's own self-service nesting tool. Fully stateless on the backend
 * (`SupplierCuttingService.preview`): nothing here is ever read from or
 * written to our own data, so unlike `supplier-catalog.ts` there's no `id`/
 * `createdAt` anywhere in this contract.
 */
export interface SupplierCuttingShapePolygon {
  outerCm: [number, number][];
  holesCm?: [number, number][][];
}

export interface SupplierCuttingMaterialInput {
  label: string;
  kind: CuttingStockKind;
  stockLengthCm: number;
  stockWidthCm?: number;
  kerfMm?: number;
  allowRotation?: boolean;
}

export interface SupplierCuttingLineInput {
  label?: string;
  qty: number;
  cutLengthCm: number;
  cutWidthCm?: number;
  cutShapePolygon?: SupplierCuttingShapePolygon;
}

export interface PreviewSupplierCuttingInput {
  material: SupplierCuttingMaterialInput;
  lines: SupplierCuttingLineInput[];
}

export interface SupplierCuttingResultCut {
  pieceLabel: string;
  pieceLengthCm: number;
  pieceWidthCm: number | null;
  posXCm: number | null;
  posYCm: number | null;
  rotated: boolean;
  shapePolygonCm: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

export interface SupplierCuttingResultStockItem {
  lengthCm: number;
  widthCm: number | null;
  cuts: SupplierCuttingResultCut[];
  leftoverLengthCm: number | null;
  leftoverWidthCm: number | null;
  usedAreaCm2: number | null;
  wasteAreaCm2: number | null;
  /** Only ever set for SHEET — a BAR cut has no 2D layout to export. */
  dxf: string | null;
}

export interface SupplierCuttingResult {
  kind: CuttingStockKind;
  stockItems: SupplierCuttingResultStockItem[];
  unitsUsed: number;
}

export function previewSupplierCutting(payload: PreviewSupplierCuttingInput): Promise<SupplierCuttingResult> {
  return supplierPortalApi.post<SupplierCuttingResult>('supplier-portal/cutting/preview', payload);
}
