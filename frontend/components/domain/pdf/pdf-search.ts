import type { ExistingTextRun } from './types';

/**
 * A page's text, flattened into one searchable string, with a map back
 * from string offsets to the run(s) that produced them. pdfjs's
 * `getTextContent()` often splits a single visual word/code across
 * several adjacent runs with NO actual space between them on screen
 * (kerning, subset-font quirks — the same class of issue found in the
 * `pdf-parse` invoice-import bug, 2026-10-27), so matching against one
 * run's `str` at a time would silently miss real occurrences, and
 * unconditionally inserting a space between every pair of runs would
 * re-break exactly those glued codes/words. Instead, whether to insert a
 * separator between two consecutive same-line runs is decided from their
 * actual horizontal gap (same geometric-threshold idea as that pdf-parse
 * fix): a small/zero/negative gap means pdfjs just split one token, so
 * runs are concatenated directly; a real visual gap gets a space. A line
 * break (`hasEOL`) always gets a newline, never a space.
 */
export interface PageSearchIndex {
  runs: ExistingTextRun[];
  /** Lower-cased, concatenated. */
  text: string;
  /** Same order/length as `runs` — each entry's [start, end) is this run's span inside `text`. */
  boundaries: { start: number; end: number }[];
}

export function buildPageSearchIndex(runs: ExistingTextRun[]): PageSearchIndex {
  let text = '';
  const boundaries: { start: number; end: number }[] = [];
  runs.forEach((run, i) => {
    const start = text.length;
    text += run.str.toLowerCase();
    boundaries.push({ start, end: text.length });
    if (i < runs.length - 1) {
      const next = runs[i + 1];
      if (run.hasEOL) {
        text += '\n';
      } else {
        const gap = next.x - (run.x + run.width);
        const gapThreshold = Math.max(run.fontSize, next.fontSize) * 0.2;
        if (gap > gapThreshold) text += ' ';
      }
    }
  });
  return { runs, text, boundaries };
}

export interface PageTextMatch {
  rect: { x: number; y: number; width: number; height: number };
}

/** Finds every occurrence of `query` in the page's flattened text, mapping each back to the bounding box of every run it overlaps (a match spanning two runs gets one highlight rect covering both). */
export function findMatchesInPage(index: PageSearchIndex, query: string): PageTextMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];

  const matches: PageTextMatch[] = [];
  let from = 0;
  for (let idx = index.text.indexOf(q, from); idx !== -1; idx = index.text.indexOf(q, from)) {
    const matchEnd = idx + q.length;
    const covered = index.runs.filter((_, i) => index.boundaries[i].start < matchEnd && index.boundaries[i].end > idx);
    if (covered.length > 0) {
      const x = Math.min(...covered.map((r) => r.x));
      const y = Math.min(...covered.map((r) => r.y));
      const right = Math.max(...covered.map((r) => r.x + r.width));
      const top = Math.max(...covered.map((r) => r.y + r.height));
      matches.push({ rect: { x, y, width: right - x, height: top - y } });
    }
    from = idx + 1;
  }
  return matches;
}
