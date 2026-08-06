// Copied verbatim from migration-toolkit/src/transform/parsing.ts (2026-08-07)
// — see transform/types.ts's header comment for why this is a copy, not an
// import.
import type { RawCellValue } from './types';

/** Prisma `Decimal` columns are written as strings (this backend's own DecimalString convention, `lib/api-client/decimal.ts` on the frontend side) — never as JS floats. Returns undefined for blank/non-numeric input, never `"0"` as a silent default (a blank price and a real zero price are different facts). */
export function parseDecimalString(raw: RawCellValue): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return String(num);
}

/** Same as parseDecimalString but returns a required "0" fallback for NOT NULL @default(0) columns (Product.qty, Product.minQty, WarehouseStock.qty). Returns the fallback flag so callers can warn. */
export function parseDecimalStringOrZero(raw: RawCellValue): { value: string; wasBlank: boolean } {
  const parsed = parseDecimalString(raw);
  return parsed === undefined ? { value: '0', wasBlank: true } : { value: parsed, wasBlank: false };
}

export function parseIntOrUndefined(raw: RawCellValue): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? Math.trunc(num) : undefined;
}

/** Falls back to undefined (never "now") for a missing/unparseable legacy date — a missing legacy date must never silently become "migrated just now". */
export function parseLegacyDate(raw: RawCellValue | Date): Date | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (raw instanceof Date) return raw;
  const str = String(raw).trim();
  if (!str) return undefined;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Accepts common real-world boolean variants a manually-edited cell could hold, not just the strict boolean type. */
export function parseLegacyBoolean(raw: RawCellValue): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'так' || normalized === 'yes';
  }
  return false;
}

/** Trims a string cell to null (never empty-string) for optional text columns. */
export function parseOptionalString(raw: RawCellValue): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  return str.length > 0 ? str : null;
}

/** Required string column with a fallback for a genuinely blank legacy cell. Returns whether the fallback was used so the caller can emit a data-quality warning. */
export function parseRequiredString(raw: RawCellValue, fallback: string): { value: string; wasBlank: boolean } {
  const trimmed = parseOptionalString(raw);
  return trimmed === null ? { value: fallback, wasBlank: true } : { value: trimmed, wasBlank: false };
}
