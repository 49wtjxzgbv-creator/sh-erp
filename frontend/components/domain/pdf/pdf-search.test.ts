import { buildPageSearchIndex, findMatchesInPage } from './pdf-search';
import type { ExistingTextRun } from './types';

function run(str: string, x: number, overrides: Partial<ExistingTextRun> = {}): ExistingTextRun {
  return { str, x, y: 700, width: str.length * 6, height: 10, fontSize: 10, ...overrides };
}

describe('pdf-search', () => {
  describe('a term fully inside one run', () => {
    it('matches and highlights exactly that run', () => {
      const runs = [run('Hello', 0, { width: 30 }), run('ABC123', 60, { width: 36 }), run('world', 120, { width: 30 })];
      const index = buildPageSearchIndex(runs);

      const matches = findMatchesInPage(index, 'ABC123');

      expect(matches).toEqual([{ rect: { x: 60, y: 700, width: 36, height: 10 } }]);
    });

    it('is case-insensitive', () => {
      const runs = [run('ABC123', 0)];
      const index = buildPageSearchIndex(runs);

      expect(findMatchesInPage(index, 'abc123')).toHaveLength(1);
    });
  });

  describe('a term split across two adjacent runs with no real gap between them (glued, same as the pdf-parse bug)', () => {
    it('matches across the run boundary and unions both rects', () => {
      const runs = [run('ABC', 0, { width: 20 }), run('123', 20, { width: 18 })]; // touching exactly — gap 0
      const index = buildPageSearchIndex(runs);

      const matches = findMatchesInPage(index, 'ABC123');

      expect(matches).toEqual([{ rect: { x: 0, y: 700, width: 38, height: 10 } }]);
    });

    it('does NOT match across a line break — runs separated by hasEOL always get a newline', () => {
      const runs = [run('ABC', 0, { width: 20, hasEOL: true }), run('123', 0, { y: 680, width: 18 })];
      const index = buildPageSearchIndex(runs);

      expect(findMatchesInPage(index, 'ABC123')).toEqual([]);
    });
  });

  describe('two runs with a real visual gap between them (separate words)', () => {
    it('does not glue them into one token', () => {
      const runs = [run('Hello', 0, { width: 30, fontSize: 10 }), run('world', 60, { width: 30, fontSize: 10 })]; // gap of 30pt, way over the ~2pt threshold
      const index = buildPageSearchIndex(runs);

      expect(findMatchesInPage(index, 'Helloworld')).toEqual([]);
      expect(findMatchesInPage(index, 'Hello world')).toHaveLength(1);
    });
  });

  it('finds multiple occurrences on one page', () => {
    const runs = [run('ABC123 foo ABC123', 0, { width: 100 })];
    const index = buildPageSearchIndex(runs);

    expect(findMatchesInPage(index, 'abc123')).toHaveLength(2);
  });

  it('returns no matches for a query not present', () => {
    const runs = [run('Hello world', 0)];
    const index = buildPageSearchIndex(runs);

    expect(findMatchesInPage(index, 'xyz')).toEqual([]);
  });

  it('returns no matches for an empty query', () => {
    const runs = [run('Hello world', 0)];
    const index = buildPageSearchIndex(runs);

    expect(findMatchesInPage(index, '')).toEqual([]);
  });
});
