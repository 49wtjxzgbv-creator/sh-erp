import type { RawCellValue } from '../types';
import { parseDecimalString, parseLegacyDate } from './parsing';

/**
 * `ProductionOrders`' three JSON blob columns -> their expansion tables
 * (Phase 3 §4, Phase 4 design doc §2.2 step 7). Real shapes confirmed by
 * reading `ProductionOrders.gs`/`ProductionStages.gs` directly (not
 * guessed):
 *  - `PickListJson`: two item shapes (ProductionOrders.gs:302-308, 327-333)
 *    — a regular product line `{ article, code, name, cell, unit, qty,
 *    photoUrl, priceEur, lineTotalEur }`, or a consumed-sub-assembly line
 *    `{ article, code: '', name, cell: '', unit: 'шт', qty, photoUrl,
 *    priceEur, lineTotalEur, consumedSerials: [...] }`.
 *  - `StageHistoryJson`: `{ stageIndex, user, at }` (ProductionStages.gs:57-61).
 *  - `AssignedWorkersJson`: `{ employeeId, percent }` (ProductionOrders.gs:394-397).
 *
 * `ProductionOrderPickListItem.productId` is deliberately nullable in the
 * target schema ("null for a finished sub-assembly consumed line" — the
 * schema's own comment) — a sub-assembly line's blob has no `productId` at
 * all (it references consumed `FinishedGood` serials instead, captured in
 * `consumedFinishedGoodIds`), while a regular product line's blob has no id
 * either (only `article`), so THAT case needs external resolution against
 * the already-migrated Product-by-article map — done here as a second pass
 * (`resolvePickListProductIds`) kept separate from parsing so the parse
 * step stays a pure, no-context function like every other parser in this
 * toolkit.
 */

export interface ParsedPickListItem {
  article: string;
  name: string;
  qty: string;
  unitPriceEur: string | undefined;
  lineTotalEur: string | undefined;
  consumedSerialsRaw: string[];
  /** true if this looks like the sub-assembly-consumption shape (has consumedSerials) rather than a plain product line. */
  isSubAssemblyLine: boolean;
}

export function parsePickListJson(raw: RawCellValue): { items: ParsedPickListItem[]; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === null || raw === undefined || raw === '') return { items: [], warnings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    warnings.push('PickListJson is not valid JSON — treated as empty.');
    return { items: [], warnings };
  }
  if (!Array.isArray(parsed)) {
    warnings.push('PickListJson is not an array — treated as empty.');
    return { items: [], warnings };
  }

  const items: ParsedPickListItem[] = parsed.map((entry) => {
    const e = entry as Record<string, unknown>;
    const consumedSerialsRaw = Array.isArray(e.consumedSerials) ? e.consumedSerials.map(String) : [];
    return {
      article: typeof e.article === 'string' ? e.article : '',
      name: typeof e.name === 'string' ? e.name : '',
      qty: parseDecimalString(e.qty as RawCellValue) ?? '0',
      unitPriceEur: parseDecimalString(e.priceEur as RawCellValue),
      lineTotalEur: parseDecimalString(e.lineTotalEur as RawCellValue),
      consumedSerialsRaw,
      isSubAssemblyLine: consumedSerialsRaw.length > 0,
    };
  });

  return { items, warnings };
}

export interface ResolvedPickListItem {
  productId: string | null;
  description: string;
  qty: string;
  unitPriceEur: string | undefined;
  lineTotalEur: string | undefined;
  consumedFinishedGoodIds: string[];
}

/** Second pass: resolves each parsed line's `article` against the already-transformed Product-by-article map. A regular product line whose article doesn't resolve keeps productId null (same "flag, don't drop the row" posture) with a warning — the line's description/qty/cost are still preserved even without a live FK, mirroring how PurchaseOrderItem/CustomerOrderItem already tolerate a dangling product reference elsewhere in this schema. Consumed finished-good serials are resolved against the FinishedGood-by-serial map built earlier in transform (finished goods are created before production orders, per the step ordering). */
export function resolvePickListItems(
  items: readonly ParsedPickListItem[],
  productIdByArticle: ReadonlyMap<string, string>,
  finishedGoodIdBySerial: ReadonlyMap<string, string>,
  describeFor: string,
): { resolved: ResolvedPickListItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const resolved = items.map((item, index) => {
    const consumedFinishedGoodIds = item.consumedSerialsRaw
      .map((serial) => finishedGoodIdBySerial.get(serial))
      .filter((id): id is string => {
        if (id) return true;
        warnings.push(`${describeFor}[${index}]: consumed serial not found among migrated FinishedGoods — omitted from consumedFinishedGoodIds.`);
        return false;
      });

    let productId: string | null = null;
    if (!item.isSubAssemblyLine && item.article) {
      productId = productIdByArticle.get(item.article) ?? null;
      if (!productId) {
        warnings.push(`${describeFor}[${index}]: article "${item.article}" did not resolve to a migrated Product — productId left null, description/qty preserved.`);
      }
    }

    return {
      productId,
      description: item.article ? `${item.article} ${item.name}`.trim() : item.name,
      qty: item.qty,
      unitPriceEur: item.unitPriceEur,
      lineTotalEur: item.lineTotalEur,
      consumedFinishedGoodIds,
    };
  });

  return { resolved, warnings };
}

export interface ParsedStageEvent {
  stageIndex: number;
  legacyUserLogin: string;
  createdAt: Date | undefined;
}

export function parseStageHistoryJson(raw: RawCellValue): { events: ParsedStageEvent[]; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === null || raw === undefined || raw === '') return { events: [], warnings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    warnings.push('StageHistoryJson is not valid JSON — treated as empty.');
    return { events: [], warnings };
  }
  if (!Array.isArray(parsed)) return { events: [], warnings };

  const events = (parsed as Record<string, unknown>[]).map((e) => ({
    stageIndex: typeof e.stageIndex === 'number' ? e.stageIndex : Number(e.stageIndex) || 0,
    legacyUserLogin: typeof e.user === 'string' ? e.user : '',
    createdAt: parseLegacyDate(e.at as RawCellValue),
  }));
  return { events, warnings };
}

export interface ParsedWorkerAssignment {
  legacyEmployeeId: string;
  percent: string;
}

export function parseAssignedWorkersJson(raw: RawCellValue): { workers: ParsedWorkerAssignment[]; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === null || raw === undefined || raw === '') return { workers: [], warnings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    warnings.push('AssignedWorkersJson is not valid JSON — treated as empty.');
    return { workers: [], warnings };
  }
  if (!Array.isArray(parsed)) return { workers: [], warnings };

  const workers = (parsed as Record<string, unknown>[]).map((e) => ({
    legacyEmployeeId: typeof e.employeeId === 'string' ? e.employeeId : String(e.employeeId ?? ''),
    percent: parseDecimalString(e.percent as RawCellValue) ?? '0',
  }));
  return { workers, warnings };
}
