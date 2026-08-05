import type { RawCellValue } from '../types';

/**
 * `QCChecks.ChecklistJson` -> `qc_check_results` (Phase 3 §4). Real shape
 * confirmed from `QualityControl.gs`'s own code comment (line 40:
 * `checklistResults = [{ item, passed }]`), stringified directly from the
 * `checklistResults` parameter of `performQualityCheck`.
 */
export interface ParsedChecklistResult {
  itemName: string;
  passed: boolean;
}

export function parseChecklistJson(raw: RawCellValue): { results: ParsedChecklistResult[]; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === null || raw === undefined || raw === '') return { results: [], warnings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    warnings.push('ChecklistJson is not valid JSON — treated as empty.');
    return { results: [], warnings };
  }
  if (!Array.isArray(parsed)) {
    warnings.push('ChecklistJson is not an array — treated as empty.');
    return { results: [], warnings };
  }

  const results = (parsed as Record<string, unknown>[]).map((e) => ({
    itemName: typeof e.item === 'string' ? e.item : String(e.item ?? ''),
    passed: e.passed === true,
  }));
  return { results, warnings };
}
