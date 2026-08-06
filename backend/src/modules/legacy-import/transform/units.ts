// Copied verbatim from migration-toolkit/src/transform/units.ts (2026-08-07)
// — see transform/types.ts's header comment for why this is a copy, not an
// import.
import type { RawRow } from './types';

/** Seed defaults verbatim from Phase 3 §7 — also what a normal (non-migration) new-company signup gets via `CompanyUnitsService.seedDefaults`. */
export const SEED_UNIT_NAMES = ['шт', 'уп', 'кг', 'м', 'рулон', 'комплект'] as const;

/** Normalizes a raw legacy Unit cell value into a trimmed name, or null if blank. Never case-folds. */
export function normalizeUnitName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Scans every Products row's `Unit` column and returns the distinct set of unit names actually used, in first-seen order. */
export function collectRequiredUnitNames(productRows: readonly RawRow[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of productRows) {
    const name = normalizeUnitName(row.Unit);
    if (name && !seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

export interface UnitCreationPlan {
  seeded: string[];
  adHoc: string[];
}

/** Partitions a company's required unit names into "already seeded" vs. "needs an ad hoc CompanyUnit row". */
export function planUnitCreation(requiredUnitNames: readonly string[]): UnitCreationPlan {
  const seedSet = new Set<string>(SEED_UNIT_NAMES);
  const seeded: string[] = [];
  const adHoc: string[] = [];
  for (const name of requiredUnitNames) {
    (seedSet.has(name) ? seeded : adHoc).push(name);
  }
  return { seeded, adHoc };
}

/** Resolves a raw legacy Unit cell to a CompanyUnit id. Returns undefined (not a thrown error) for a blank/unresolvable unit. */
export function resolveUnitId(raw: unknown, unitIdByName: ReadonlyMap<string, string>): string | undefined {
  const name = normalizeUnitName(raw);
  if (!name) return undefined;
  return unitIdByName.get(name);
}
