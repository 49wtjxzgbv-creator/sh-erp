/**
 * The old system's "default warehouse" quantity was never a stored row —
 * it was always computed as `Products.Qty minus the sum of every named
 * warehouse's explicit WarehouseStock rows` (Phase 1 §6.6, the schema's own
 * header comment: "a view, not a ledger"). The new schema has no such
 * implicit case — EVERY warehouse, including the default one, needs a real
 * `WarehouseStock` row (Phase 4 design doc §2.2 step 6). This is flagged in
 * the design doc as "one of the two 'verify' checks with the highest chance
 * of a silent off-by-something bug", so this computation is pulled out into
 * its own small, heavily-tested pure function rather than inlined into the
 * bigger inventory transform step.
 */

export interface RemainderComputation {
  /** Products.Qty minus every named warehouse's explicit stock — the value to materialize into the default warehouse's WarehouseStock row. */
  remainder: string;
  /** True when the computed remainder is negative — a real data-integrity problem in the source (named-warehouse stock exceeds the product's total qty), not something this function silently clamps to zero. Must be surfaced in the reconciliation report (verify.ts), never hidden. */
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
