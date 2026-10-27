import type { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** One loaded PDF the working document draws pages from — 'main' is the document that was opened; merging in another file adds a new source with a generated id. Both representations are kept in sync: pdfLibDoc for export (copyPages/draw), pdfjsDoc for rendering. */
export interface PdfSource {
  id: string;
  pdfLibDoc: PDFDocument;
  pdfjsDoc: PDFDocumentProxy;
}

/** One page in the CURRENT working order — `key` is a stable id independent of position (survives reordering), so annotations and React keys never silently reattach to the wrong page after a drag. `sourceIndex` is 0-based into that source's own page list. `rotation` is a delta ON TOP OF the page's own embedded rotation, not an absolute value. */
export interface WorkingPage {
  key: string;
  sourceId: string;
  sourceIndex: number;
  rotation: number;
}

export type AnnotationTool = 'select' | 'highlight' | 'note' | 'draw' | 'text' | 'edit';

/** The two Cyrillic-capable fonts embedded at export time — see scripts/copy-pdf-font.js's own header comment for why only these two (not pdf-lib's built-in StandardFonts) are usable at all for this app's userbase. */
export type TextFontFamily = 'sans' | 'serif';

/** Every coordinate is in the page's OWN intrinsic PDF point space (origin bottom-left, Y up) — the same space pdf-lib's draw* methods use natively, and what pdfjs's PageViewport#convertToPdfPoint/convertToViewportPoint round-trip to/from screen pixels. Storing here (not normalized screen fractions) is what keeps an annotation correctly placed across zoom AND rotation changes — see pdf-page-canvas.tsx's own header comment. */
export type Annotation =
  | { id: string; pageKey: string; type: 'highlight'; x: number; y: number; width: number; height: number }
  | { id: string; pageKey: string; type: 'note'; x: number; y: number; text: string }
  | { id: string; pageKey: string; type: 'draw'; points: { x: number; y: number }[] }
  // A brand-new text block (the "Текст" tool) OR the replacement half of an edited/moved
  // existing text run (the "Редагувати" tool always pairs one of these with a 'redact' —
  // see that type's own comment) — pdf-lib bakes this with a standard font (Helvetica), so
  // it visually matches the original closely but is never byte-identical to an embedded
  // subset font. That tradeoff is the whole reason 'edit' exists instead of true
  // content-stream text rewriting — see pdf-page-canvas.tsx's header comment.
  | { id: string; pageKey: string; type: 'text'; x: number; y: number; width: number; fontSize: number; fontFamily: TextFontFamily; color: string; text: string }
  // An opaque white cover drawn over a region of the ORIGINAL page content — this is how
  // "editing" or "moving" existing text/an image actually works: the real glyphs/pixels in
  // the source PDF can't be surgically removed from its content stream, so a redact sits
  // UNDER the replacement 'text' or 'image' annotation and visually hides the original.
  | { id: string; pageKey: string; type: 'redact'; x: number; y: number; width: number; height: number }
  // A bitmap captured straight off the rendered <canvas> (not a parsed PDF image object —
  // extracting/replacing an actual image XObject from the content stream has the same
  // infeasibility problem true text-rewriting does) — this is what lets the "Редагувати"
  // tool "move" an existing picture: cut its pixels, cover the original with a 'redact',
  // drop the cut bitmap at a new position as a normal draggable/resizable annotation.
  | { id: string; pageKey: string; type: 'image'; x: number; y: number; width: number; height: number; dataUrl: string };

/** One run from pdfjs's own `getTextContent()` — already in the page's intrinsic PDF-space coordinates (pdfjs calls this "device space" in its own types, but it's the same unrotated/unscaled space as everything else here), so no conversion is needed before treating it exactly like any other Annotation-space rectangle. */
export interface ExistingTextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  /** pdfjs's own "end of line" flag on the text-content item — only used by pdf-search.ts to decide whether to join this run to the next with a space (same line) or a newline (new line) when building a page's searchable text; every other consumer of ExistingTextRun ignores it. */
  hasEOL?: boolean;
}

/** One image XObject's placement, recovered by walking `getOperatorList()`'s save/transform/restore stack to the CTM at each `paintImageXObject` call and projecting the unit square through it — see pdf-page-canvas.tsx's own loader for why this (not a user-dragged rectangle) is how the "Редагувати" tool finds pictures to move. Already in the page's intrinsic PDF-space coordinates, same as ExistingTextRun. */
export interface ExistingImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** '#rrggbb' -> {r,g,b} in pdf-lib's 0-1 range, for `rgb()` at export time. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? [];
  const [, rHex, gHex, bHex] = m;
  return {
    r: parseInt(rHex ?? '11', 16) / 255,
    g: parseInt(gHex ?? '18', 16) / 255,
    b: parseInt(bHex ?? '27', 16) / 255,
  };
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}
