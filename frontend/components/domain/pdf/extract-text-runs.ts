import type { PDFPageProxy } from 'pdfjs-dist';
import type { ExistingTextRun } from './types';

/**
 * Shared by pdf-page-canvas.tsx (the "Редагувати" tool's hit-testing) and
 * pdf-search.ts (whole-document search) — both need the same
 * `getTextContent()` → PDF-point-space run list, so this lives here once
 * instead of being duplicated.
 */
export async function extractTextRuns(pdfPage: PDFPageProxy): Promise<ExistingTextRun[]> {
  const textContent = await pdfPage.getTextContent();
  const runs: ExistingTextRun[] = [];
  for (const item of textContent.items) {
    if (!('str' in item) || !('transform' in item)) continue; // TextMarkedContent, not an actual glyph run
    if (!item.str || !item.str.trim()) continue;
    const t = item.transform;
    const fontSize = Math.abs(t[3]) || Math.abs(t[2]) || item.height || 10;
    runs.push({ str: item.str, x: t[4], y: t[5], width: item.width, height: item.height || fontSize, fontSize, hasEOL: item.hasEOL });
  }
  return runs;
}
