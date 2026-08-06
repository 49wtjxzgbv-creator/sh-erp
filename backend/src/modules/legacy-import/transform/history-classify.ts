// Copied verbatim from migration-toolkit/src/transform/history-classify.ts
// (2026-08-07) — see transform/types.ts's header comment for why this is a
// copy, not an import.
//
// `History` sheet rows split into `stock_movements` (structured,
// stock-quantity-specific) vs `audit_events` (everything else). A
// stock-affecting action label is necessary but not sufficient for a
// StockMovement: `StockMovement.productId` is a required FK, so a row with a
// stock-affecting label but no resolvable Article falls through to
// AuditEvent instead.

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

const STOCK_ACTION_MAP: Record<string, StockMovementTypeForHistory> = {
  'Прихід': 'RECEIVE',
  'Видача': 'ISSUE',
  'Списання браку': 'DEFECT_WRITE_OFF',
  'Коригування': 'ADJUST',
  'Переміщення': 'MOVE',
  'Списання на виріб': 'PRODUCTION_CONSUMPTION',
  'Створення товару': 'RECEIVE',
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
