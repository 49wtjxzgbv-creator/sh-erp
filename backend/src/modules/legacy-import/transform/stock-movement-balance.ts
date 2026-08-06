// Copied verbatim from migration-toolkit/src/transform/stock-movement-balance.ts
// (2026-08-07) — see transform/types.ts's header comment for why this is a
// copy, not an import.
//
// `StockMovement.qtyAfter` is a REQUIRED column but the legacy `History`
// sheet never stored a running balance, only a per-event delta — this walks
// each product's movements BACKWARD from the known-correct final quantity
// (Products.Qty), subtracting each movement's delta to derive the balance
// immediately before it. Assumes movements for a given product arrive in
// true chronological order (the legacy History sheet's natural append order
// already is).

export interface ChronologicalMovement {
  id: string;
  productId: string;
  qtyDelta: string;
}

/** Returns movement id -> qtyAfter (decimal string), for every movement whose product has a known final qty. */
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
    for (let i = movements.length - 1; i >= 0; i--) {
      result.set(movements[i].id, String(runningQty));
      runningQty -= Number(movements[i].qtyDelta) || 0;
    }
  }
  return result;
}
