import { google, sheets_v4 } from 'googleapis';
import { SHEET_SCHEMAS, ALL_SHEET_KEYS, PRODUCT_LEGACY_COLUMN_ALIASES, type SheetKey } from './sheet-schemas';
import type { MigrationSnapshot, SheetSnapshot, RawRow, RawCellValue } from './types';

/**
 * Stage 1 — Extract (Phase 4 design doc §2.1). Read-only against the source
 * Google Sheet: pulls all 26 migratable tabs via the Sheets API (never via
 * re-running Apps Script code — this CLI is standalone, decoupled from the
 * legacy runtime it's replacing), into raw `RawRow[]` snapshots with zero
 * transformation. Never writes back to the source spreadsheet.
 *
 * NEVER EXERCISED FOR REAL IN THIS SANDBOX, disclosed rather than glossed
 * over: this sandbox has no route to a real Google service account or a
 * real customer spreadsheet (same standing network-boundary as every other
 * external-API-touching piece of this project — Prisma's binaries.prisma.sh,
 * a live Postgres, a live Gemini key, live Stripe). The code below is real,
 * type-checked, and structurally faithful to the Sheets API's actual
 * `spreadsheets.values.get` contract, but it has never been run against an
 * actual spreadsheet. Test it against a real (ideally non-production, or a
 * duplicated) spreadsheet before trusting it for a real company's cutover.
 */

export interface ExtractOptions {
  sourceSheetId: string;
  companySlug: string;
  /** Optional: only extract these sheets (useful for iterating on one entity's transform logic without re-reading all 26 tabs). Defaults to all 26. */
  onlySheets?: SheetKey[];
  /** Path to a Google service-account JSON key file. Defaults to GOOGLE_APPLICATION_CREDENTIALS env var, same as every other googleapis-based tool. */
  credentialsPath?: string;
}

function getSheetsClient(credentialsPath?: string): sheets_v4.Sheets {
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Builds a name -> columnIndex map from the sheet's ACTUAL row 1, never assumes the canonical order (see sheet-schemas.ts header comment for why). */
function buildHeaderIndexMap(headerRow: RawCellValue[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    if (typeof cell === 'string' && cell.length > 0 && !map.has(cell)) {
      map.set(cell, index);
    }
  });
  return map;
}

async function extractOneSheet(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetKey: SheetKey,
): Promise<SheetSnapshot> {
  const schema = SHEET_SCHEMAS[sheetKey];

  const response = await client.spreadsheets.values.get({
    spreadsheetId,
    range: schema.tabName, // whole sheet, all used rows/cols
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const values = (response.data.values ?? []) as RawCellValue[][];
  const [headerRow, ...dataRows] = values;
  const headerRowAsRead = (headerRow ?? []).map((cell) => String(cell ?? ''));
  const indexMap = buildHeaderIndexMap(headerRow ?? []);

  const columnAliasesUsed: Record<string, string> = {};
  const resolvedIndexFor = (canonicalHeader: string): number | undefined => {
    if (indexMap.has(canonicalHeader)) return indexMap.get(canonicalHeader);
    if (sheetKey === 'products' && canonicalHeader in PRODUCT_LEGACY_COLUMN_ALIASES) {
      const alias = PRODUCT_LEGACY_COLUMN_ALIASES[canonicalHeader];
      if (indexMap.has(alias)) {
        columnAliasesUsed[canonicalHeader] = alias;
        return indexMap.get(alias);
      }
    }
    return undefined;
  };

  const rows: RawRow[] = dataRows
    .filter((row) => row.some((cell) => cell !== undefined && cell !== null && cell !== ''))
    .map((row) => {
      const rawRow: RawRow = {};
      for (const canonicalHeader of schema.headers) {
        const idx = resolvedIndexFor(canonicalHeader);
        rawRow[canonicalHeader] = idx === undefined ? null : (row[idx] ?? null);
      }
      return rawRow;
    });

  return {
    sheetKey,
    tabName: schema.tabName,
    headerRowAsRead,
    columnAliasesUsed,
    rows,
  };
}

export async function extractCompany(options: ExtractOptions): Promise<MigrationSnapshot> {
  const client = getSheetsClient(options.credentialsPath);
  const sheetKeys = options.onlySheets ?? ALL_SHEET_KEYS;

  const sheets: MigrationSnapshot['sheets'] = {};
  // Sequential, not Promise.all — Sheets API has per-minute quota limits per
  // project, and 26 sequential reads of a small business's spreadsheet is
  // fast enough that parallelizing isn't worth the quota risk on a real
  // customer's first cutover attempt.
  for (const sheetKey of sheetKeys) {
    sheets[sheetKey] = await extractOneSheet(client, options.sourceSheetId, sheetKey);
  }

  return {
    companySlug: options.companySlug,
    sourceSheetId: options.sourceSheetId,
    extractedAt: new Date().toISOString(),
    sheets,
  };
}
