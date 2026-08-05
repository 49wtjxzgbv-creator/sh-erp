import type { RawCellValue } from '../types';

/**
 * Shared raw-cell -> typed-value coercions, used by every per-sheet
 * transform module. Kept in one place so every sheet parses numbers/dates/
 * booleans the same way rather than each transform file reinventing its own
 * (subtly different) coercion rules.
 */

/** Prisma `Decimal` columns are written as strings (this backend's own DecimalString convention, `lib/api-client/decimal.ts` on the frontend side) — never as JS floats, consistent with the schema header's own warning about the old system's float-precision incident. Returns undefined for blank/non-numeric input, never `"0"` as a silent default (a blank price and a real zero price are different facts). */
export function parseDecimalString(raw: RawCellValue): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return String(num);
}

/** Same as parseDecimalString but returns a required "0" fallback for NOT NULL @default(0) columns (Product.qty, Product.minQty, WarehouseStock.qty) — those columns can never be null in the target schema, so an unparseable/blank source cell becomes an explicit, reported 0, not a thrown error. Returns the fallback flag so callers can warn. */
export function parseDecimalStringOrZero(raw: RawCellValue): { value: string; wasBlank: boolean } {
  const parsed = parseDecimalString(raw);
  return parsed === undefined ? { value: '0', wasBlank: true } : { value: parsed, wasBlank: false };
}

export function parseIntOrUndefined(raw: RawCellValue): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? Math.trunc(num) : undefined;
}

/** Legacy `nowStr_()` (Code.gs) writes timestamps as a locale-formatted string, not ISO — the Sheets API extract uses `dateTimeRenderOption: 'FORMATTED_STRING'` (extract.ts) specifically so this function receives the same string a human would see in the sheet, then lets JS's Date parser (which handles most common locale formats) do the work, falling back to undefined (never to `new Date()` "now" — a missing legacy date must never silently become "migrated just now"). */
export function parseLegacyDate(raw: RawCellValue | Date): Date | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (raw instanceof Date) return raw;
  const str = String(raw).trim();
  if (!str) return undefined;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Legacy boolean columns (`Active`, `IsDefault`, `Counted`) were written by `setValue(true/false)` (real Sheets booleans) in the common case, but a manually-edited cell could hold `'TRUE'`/`'так'`/`1` etc. — accepts the common real-world variants rather than only the strict boolean type. */
export function parseLegacyBoolean(raw: RawCellValue): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'так' || normalized === 'yes';
  }
  return false;
}

/** Trims a string cell to null (never empty-string) for optional text columns — keeps blank-vs-absent unambiguous, matching how the rest of this backend treats optional string fields. */
export function parseOptionalString(raw: RawCellValue): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  return str.length > 0 ? str : null;
}

/** Required string column with a fallback for a genuinely blank legacy cell (rare, but the old system had no server-side required-field validation on most sheets — Phase 1 §10's documented technical debt). Returns whether the fallback was used so the caller can emit a data-quality warning. */
export function parseRequiredString(raw: RawCellValue, fallback: string): { value: string; wasBlank: boolean } {
  const trimmed = parseOptionalString(raw);
  return trimmed === null ? { value: fallback, wasBlank: true } : { value: trimmed, wasBlank: false };
}
