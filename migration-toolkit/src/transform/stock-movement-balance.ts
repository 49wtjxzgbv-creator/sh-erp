/**
 * `StockMovement.qtyAfter` is a REQUIRED (non-nullable) column — the
 * running balance immediately after that movement. The legacy `History`
 * sheet never stored a running balance, only a per-event delta (`Qty`,
 * confirmed from `logHistory_`'s signature in `History.gs`) — so this value
 * cannot be read off the source data directly, and a naive placeholder
 * (e.g. reusing the delta itself) would silently write WRONG numbers into a
 * warehouse-management system's stock ledger, which is worse than an
 * honest gap.
 *
 * Real reconstruction is possible, though, because we DO know the correct
 * ending state exactly: `Products.Qty` is, by construction, the quantity
 * AFTER every one of that product's migrated `StockMovement` rows has been
 * applied (it's literally what the legacy warehouse functions maintained on
 * every mutating call). So this function walks each product's movements
 * BACKWARD from that known-correct final quantity, subtracting each
 * movement's own delta to derive what the balance must have been
 * immediately before it — which is exactly the `qtyAfter` of the PREVIOUS
 * movement. Assumes the movements for a given product are supplied in true
 * chronological order; `logHistory_` always `appendRow`s (Google Sheets
 * sheets are append-only in practice for this codebase), so the History
 * sheet's natural row order already IS chronological — transform builds
 * `stockMovements` in that same row order, so no separate date-sort is
 * needed or attempted here (a `createdAt` sort would be LESS reliable,
 * since some legacy timestamp strings fail to parse — see
 * `parseLegacyDate`).
 *
 * This computation is only as correct as its assumption that Products.Qty
 * really does equal "sum of every migrated movement's delta" for that
 * product — if some historical stock change was never logged (a documented
 * possibility given the legacy system's technical debt, Phase 1 §10), the
 * reconstructed `qtyAfter` values for that product's OLDER movements will
 * be off by a constant amount, even though the newest one (equal to
 * Products.Qty) is still exactly right. Disclosed in the toolkit's README
 * as a real, bounded limitation — not silently assumed perfect.
 */

export interface ChronologicalMovement {
  id: string;
  productId: string;
  qtyDelta: string;
}

/** Returns a map of movement id -> qtyAfter (as a decimal string), for every movement whose product has a known final qty. Movements for a product with no known final qty are simply absent from the returned map — callers should treat that as "cannot compute, do not guess" (see computeQtyAfterOrFallback below for a practical loader-side fallback). */
export function computeQtyAfterSeries(
  movementsInChronologicalOrder: readonly ChronologicalMovement[],
  finalQtyByProductId: ReadonlyMap<string, string>,
): Map<string, string> {
  const byProduct = new Map<string, ChronologicalMovement[]>();
  for (const m of movementsInChronologicalOrder) {
    const list = byProduct.get(m.productId) ?? [];
    list.push(m);
    byProduct.set(m.productId, list);
  }

  const result = new Map<string, string>();
  for (const [productId, movements] of byProduct) {
    const finalQty = finalQtyByProductId.get(productId);
    if (finalQty === undefined) continue;
    let runningQty = Number(finalQty) || 0;
    // Walk backward: the LAST movement's qtyAfter is the known final qty; each earlier movement's qtyAfter is the running total BEFORE the movement after it was applied.
    for (let i = movements.length - 1; i >= 0; i--) {
      result.set(movements[i].id, String(runningQty));
      runningQty -= Number(movements[i].qtyDelta) || 0;
    }
  }
  return result;
}
