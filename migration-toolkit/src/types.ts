import type { SheetKey } from './sheet-schemas';

/** A single Google Sheets cell value, as returned by the Sheets API's default value-render option. `undefined` is included alongside `null` purely for TypeScript ergonomics — plain object literals (fixtures, test rows) that omit a key are `undefined` at that key, not `null`; both mean "no value" throughout this toolkit. */
export type RawCellValue = string | number | boolean | null | undefined;

/** One legacy sheet row, keyed by its REAL column header string (see sheet-schemas.ts). */
export type RawRow = Record<string, RawCellValue>;

/**
 * The immutable "what we actually read" record for one sheet (Phase 4
 * design doc §2.1) — extract never transforms, it only snapshots raw rows
 * plus enough metadata to audit exactly what was read and how.
 */
export interface SheetSnapshot {
  sheetKey: SheetKey;
  tabName: string;
  /** The real header row as read from row 1 of the live sheet — may differ in order/casing from sheet-schemas.ts's canonical list, see that file's header comment. */
  headerRowAsRead: string[];
  /** canonical header name -> alias actually found in its place, only populated when a fallback (e.g. PRODUCT_LEGACY_COLUMN_ALIASES) was used. */
  columnAliasesUsed: Record<string, string>;
  rows: RawRow[];
}

/** One full per-company extraction — every one of the 26 sheets, snapshotted at the same moment. */
export interface MigrationSnapshot {
  companySlug: string;
  sourceSheetId: string;
  extractedAt: string; // ISO 8601
  sheets: Partial<Record<SheetKey, SheetSnapshot>>;
}

/**
 * Operator-supplied metadata for a migration run — NOT derived from sheet
 * data (Phase 4 design doc §2.2 step 1: "the old system has no Company
 * concept at all").
 */
export interface CompanyMigrationInput {
  companySlug: string;
  companyName: string;
  timezone?: string;
  locale?: string;
  /** Old Apps Script deployment identifier, stored on Company.legacyId for support traceability. */
  sourceDeploymentId?: string;
  /** The owner account created alongside the company (mirrors CompanyService.createCompany's shape — a migration always needs at least one login-capable admin). */
  ownerEmail: string;
  ownerFullName: string;
  /** Plaintext, hashed with argon2 exactly like CompanyService.createCompany — never stored raw. */
  ownerPassword: string;
}
