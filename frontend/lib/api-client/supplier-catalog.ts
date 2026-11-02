import type { DecimalString } from './decimal';
import type { CuttingStockKind } from './cutting';
import type { FileAssetWithUrl } from './files';

/**
 * Typed shape for SupplierPortalService's catalog endpoints
 * (`supplier-portal/catalog*`) — every product ever sent to this supplier
 * via a PurchaseOrder/sent PurchaseRequest, backed by `ProductSupplier`.
 * Deliberately has NO `price`/`isDefault` fields — those are staff's own
 * and the backend never includes them in this response at all.
 */
export interface SupplierCatalogEntry {
  id: string;
  productId: string;
  article: string;
  name: string;
  weightPerUnitKg: DecimalString | null;
  photoUrl: string | null;
  /** Full FileAsset rows (not truncated) — same shape the main /catalog page's View3DButton/ArViewButton already consume, so the supplier portal can offer the same 3D/AR quick-look. */
  files: FileAssetWithUrl[];
  cuttingSpec: {
    kind: CuttingStockKind;
    stockLengthCm: DecimalString;
    stockWidthCm: DecimalString | null;
    defaultCutLengthCm: DecimalString | null;
    defaultCutWidthCm: DecimalString | null;
    defaultCutShapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
  } | null;
  /** "собівартість" — the supplier's own private note, for their own reference only. */
  supplierCostPrice: DecimalString | null;
  /** The price at which the supplier says they'll sell this to us. */
  supplierOfferedPrice: DecimalString | null;
  createdAt: string;
}

export interface UpdateSupplierCatalogEntryInput {
  supplierCostPrice?: number;
  supplierOfferedPrice?: number;
}
