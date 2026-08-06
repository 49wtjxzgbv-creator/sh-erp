// Copied verbatim from migration-toolkit/src/transform/warehouse-remainder.ts
// (2026-08-07) — see transform/types.ts's header comment for why this is a
// copy, not an import.
//
// The old system's "default warehouse" quantity was never a stored row — it
// was always Products.Qty minus every named warehouse's explicit
// WarehouseStock rows. The new schema needs a real WarehouseStock row for
// the default warehouse too, so this computes and materializes it.

export interface RemainderComputation {
  remainder: string;
  /** True when negative — a real data-integrity problem in the source (named-warehouse stock exceeds total qty), never silently clamped to zero. Must be surfaced in the import report. */
  isNegative: boolean;
}

export function computeDefaultWarehouseRemainder(
  productQty: string,
  namedWarehouseQuantities: readonly string[],
): RemainderComputation {
  const totalQty = Number(productQty) || 0;
  const namedSum = namedWarehouseQuantities.reduce((sum, q) => sum + (Number(q) || 0), 0);
  const remainder = totalQty - namedSum;
  return {
    remainder: String(remainder),
    isNegative: remainder < 0,
  };
}
