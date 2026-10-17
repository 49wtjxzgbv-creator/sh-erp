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

export type AnnotationTool = 'select' | 'highlight' | 'note' | 'draw';

/** Every coordinate is in the page's OWN intrinsic PDF point space (origin bottom-left, Y up) — the same space pdf-lib's draw* methods use natively, and what pdfjs's PageViewport#convertToPdfPoint/convertToViewportPoint round-trip to/from screen pixels. Storing here (not normalized screen fractions) is what keeps an annotation correctly placed across zoom AND rotation changes — see pdf-page-canvas.tsx's own header comment. */
export type Annotation =
  | { id: string; pageKey: string; type: 'highlight'; x: number; y: number; width: number; height: number }
  | { id: string; pageKey: string; type: 'note'; x: number; y: number; text: string }
  | { id: string; pageKey: string; type: 'draw'; points: { x: number; y: number }[] };

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}
