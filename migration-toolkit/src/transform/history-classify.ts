/**
 * `History` sheet -> `audit_events` (generic) + `stock_movements`
 * (stock-quantity-specific), per Phase 3 §6's deliberate split of the old
 * flat free-text log. Real `Action` string vocabulary confirmed by grepping
 * every `logHistory_(...)` call site across all `.gs` files (not guessed —
 * `History.gs:7`'s `logHistory_` is called from ~30 places, each passing a
 * literal or small-enum action label). Design doc §2.2 step 9's own
 * language: "this is a per-row classification step ... explicitly allowed
 * to be imperfect at the margins — anything that doesn't clearly classify
 * falls through to AuditEvent with the original text preserved in
 * `metadata`, never dropped."
 *
 * A stock-affecting action label is NECESSARY but not SUFFICIENT for a
 * `StockMovement` classification: `StockMovement.productId` is a required
 * (non-nullable) FK, so a History row with a stock-affecting action label
 * but a BLANK `Article` (e.g. `Інвентаризація завершена`'s session-level
 * summary row, or `Використано готовий виріб як компонент`'s sub-assembly
 * consumption row, which references a sub-assembly by name, not a `Product`
 * article) cannot become a valid `StockMovement` and is downgraded to
 * `AuditEvent` instead — disclosed here as a real, intentional scope
 * boundary, not a bug: those two action types are genuine stock-relevant
 * events, but this schema's `StockMovement` model has no way to represent
 * "sub-assembly consumption with no single product line" or "inventory
 * session net effect" without a resolvable article, so they're captured as
 * audit history instead of a structured ledger row.
 */

export type StockMovementTypeForHistory =
  | 'RECEIVE'
  | 'ISSUE'
  | 'ADJUST'
  | 'MOVE'
  | 'DEFECT_WRITE_OFF'
  | 'PRODUCTION_CONSUMPTION';

export type HistoryClassification =
  | { kind: 'STOCK_MOVEMENT'; movementType: StockMovementTypeForHistory }
  | { kind: 'AUDIT_EVENT'; reason: string };

/** Real action-label -> StockMovementType map, sourced from the logHistory_ call sites listed in this file's header comment. Every OTHER real action label observed in source (order/status/QC/shipment/payroll/stage events, product create/edit/delete metadata, imports) is intentionally absent — it always classifies as AuditEvent, per the fall-through rule. */
const STOCK_ACTION_MAP: Record<string, StockMovementTypeForHistory> = {
  'Прихід': 'RECEIVE',
  'Видача': 'ISSUE',
  'Списання браку': 'DEFECT_WRITE_OFF',
  'Коригування': 'ADJUST',
  'Переміщення': 'MOVE',
  'Списання на виріб': 'PRODUCTION_CONSUMPTION',
  'Створення товару': 'RECEIVE', // Products.gs:286 — initial-stock line, "Початковий залишок"
};

export interface HistoryRowForClassification {
  action: string;
  article: string;
  qty: number;
}

export function classifyHistoryRow(row: HistoryRowForClassification): HistoryClassification {
  const movementType = STOCK_ACTION_MAP[row.action.trim()];
  if (!movementType) {
    return { kind: 'AUDIT_EVENT', reason: `action "${row.action}" is not a recognized stock-affecting action` };
  }
  if (!row.article.trim()) {
    return { kind: 'AUDIT_EVENT', reason: `action "${row.action}" has no resolvable Article — cannot form a valid StockMovement (required productId FK)` };
  }
  if (row.action.trim() === 'Створення товару' && row.qty === 0) {
    return { kind: 'AUDIT_EVENT', reason: 'product creation with a zero initial qty — no real quantity change to ledger' };
  }
  return { kind: 'STOCK_MOVEMENT', movementType };
}
