import type { RawRow } from '../types';

/**
 * Product.unitId resolution (Phase 4 design doc §2.2 step 2 — "a new
 * ordering requirement from decision 1"): `Product.unitId` is now a
 * required composite FK to `CompanyUnit`, replacing the old free-text
 * `Unit` column where "any string just worked" (Setup.gs `PRODUCT_HEADERS`
 * has no unit validation at all). Every distinct unit string used across
 * the legacy `Products` sheet must resolve to a real `CompanyUnit` row
 * BEFORE any `Product` row is built — for a unit string not already in the
 * default seed list, transform creates an ad hoc `CompanyUnit` row for it
 * rather than failing the whole migration or silently coercing it to a
 * default (same design-doc language used for supplier-name resolution).
 *
 * Seed defaults verbatim from Phase 3 §7 ("seed default CompanyUnit rows
 * (шт, уп, кг, м, рулон, комплект), mirroring `seedUnitsIfEmpty_`") — these
 * are also what a normal (non-migration) new-company signup gets via
 * `CompanyUnitsService.seedDefaults`.
 */
export const SEED_UNIT_NAMES = ['шт', 'уп', 'кг', 'м', 'рулон', 'комплект'] as const;

/** Normalizes a raw legacy Unit cell value into a trimmed name, or null if blank. Never case-folds — CompanyUnit's uniqueness is a plain string match, and case-folding risks silently merging two units the operator intended to keep distinct. */
export function normalizeUnitName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Scans every Products row's `Unit` column and returns the distinct set of
 * unit names actually used, in first-seen order — this drives ad hoc
 * `CompanyUnit` creation for anything beyond the 6 seed defaults.
 */
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
  /** Unit names already covered by the standard seed list — no ad hoc row needed, just resolve to the seeded CompanyUnit's id. */
  seeded: string[];
  /** Unit names used by real legacy Product rows that aren't in the seed list — transform must create a CompanyUnit row for each of these too. */
  adHoc: string[];
}

/** Partitions a company's required unit names into "already seeded" vs. "needs an ad hoc CompanyUnit row". Order-preserving, case-sensitive exact match against SEED_UNIT_NAMES. */
export function planUnitCreation(requiredUnitNames: readonly string[]): UnitCreationPlan {
  const seedSet = new Set<string>(SEED_UNIT_NAMES);
  const seeded: string[] = [];
  const adHoc: string[] = [];
  for (const name of requiredUnitNames) {
    (seedSet.has(name) ? seeded : adHoc).push(name);
  }
  return { seeded, adHoc };
}

/** Resolves a raw legacy Unit cell to a CompanyUnit id, given the name->id map built after seed+ad-hoc creation. Returns undefined (not a thrown error) for a blank/unresolvable unit — the caller (products.ts) turns that into a per-row data-quality warning, consistent with this project's "flag the rest, never silently drop" convention. */
export function resolveUnitId(raw: unknown, unitIdByName: ReadonlyMap<string, string>): string | undefined {
  const name = normalizeUnitName(raw);
  if (!name) return undefined;
  return unitIdByName.get(name);
}
