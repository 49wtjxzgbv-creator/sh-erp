import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MigrationSnapshot, SheetSnapshot } from './types';
import type { SheetKey } from './sheet-schemas';

/**
 * Snapshot-to-disk persistence (Phase 4 design doc §2.1: "This snapshot is
 * saved to disk ... and timestamped — it's the immutable 'what we actually
 * read' record, so a transform bug can be fixed and re-run against the same
 * extracted data without re-reading the source spreadsheet"). One directory
 * per run: `<baseDir>/<companySlug>/<extractedAt-sanitized>/`, one JSON file
 * per sheet plus a `manifest.json` carrying the run-level metadata. Deliberately
 * plain files, not a database table — a snapshot needs to exist and be
 * inspectable before any Postgres connection is even configured (extract can
 * run on a laptop with no DATABASE_URL at all).
 */

function runDir(baseDir: string, companySlug: string, extractedAt: string): string {
  const safeStamp = extractedAt.replace(/[:.]/g, '-');
  return join(baseDir, companySlug, safeStamp);
}

export function writeSnapshot(baseDir: string, snapshot: MigrationSnapshot): string {
  const dir = runDir(baseDir, snapshot.companySlug, snapshot.extractedAt);
  mkdirSync(dir, { recursive: true });

  const manifest = {
    companySlug: snapshot.companySlug,
    sourceSheetId: snapshot.sourceSheetId,
    extractedAt: snapshot.extractedAt,
    sheetKeys: Object.keys(snapshot.sheets),
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  for (const [sheetKey, sheetSnapshot] of Object.entries(snapshot.sheets)) {
    writeFileSync(join(dir, `${sheetKey}.json`), JSON.stringify(sheetSnapshot, null, 2), 'utf-8');
  }

  return dir;
}

export function readSnapshot(dir: string): MigrationSnapshot {
  if (!existsSync(dir)) {
    throw new Error(`Snapshot directory does not exist: ${dir}`);
  }
  const manifestRaw = readFileSync(join(dir, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw) as {
    companySlug: string;
    sourceSheetId: string;
    extractedAt: string;
    sheetKeys: SheetKey[];
  };

  const sheets: Partial<Record<SheetKey, SheetSnapshot>> = {};
  for (const sheetKey of manifest.sheetKeys) {
    const raw = readFileSync(join(dir, `${sheetKey}.json`), 'utf-8');
    sheets[sheetKey] = JSON.parse(raw) as SheetSnapshot;
  }

  return {
    companySlug: manifest.companySlug,
    sourceSheetId: manifest.sourceSheetId,
    extractedAt: manifest.extractedAt,
    sheets,
  };
}

/** Lists available run timestamps for a company, most recent last — used by the CLI's `--from-snapshot latest` shorthand. */
export function listRuns(baseDir: string, companySlug: string): string[] {
  const companyDir = join(baseDir, companySlug);
  if (!existsSync(companyDir)) return [];
  return readdirSync(companyDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function latestRunDir(baseDir: string, companySlug: string): string | undefined {
  const runs = listRuns(baseDir, companySlug);
  const last = runs.at(-1);
  return last ? join(baseDir, companySlug, last) : undefined;
}
