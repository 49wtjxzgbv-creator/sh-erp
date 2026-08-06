/**
 * Copied from migration-toolkit/src/types.ts (RawCellValue/RawRow only —
 * SheetSnapshot/MigrationSnapshot/CompanyMigrationInput are Sheets-API-
 * specific and don't apply here, see this module's own apps-script-client.ts
 * for the Apps Script Web App payload shape instead). No shared npm
 * workspace exists between backend/ and migration-toolkit/ (deliberately not
 * introduced for a handful of files — see the migration plan doc), so this
 * is a copy, not an import; keep in sync by hand if the source ever changes.
 */

/** A single legacy cell value, exactly as the Apps Script Web App emits it (mirrors what the Sheets API would have returned for the same cell). */
export type RawCellValue = string | number | boolean | null | undefined;

/** One legacy sheet row, keyed by its real column header string (see sheet-schemas.ts in migration-toolkit for the canonical per-sheet header lists this project already uses). */
export type RawRow = Record<string, RawCellValue>;
