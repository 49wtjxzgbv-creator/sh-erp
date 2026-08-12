/**
 * `DxfParser.parseSync` plus this file's own `extractSegments`/
 * `computeBoundingBox` are synchronous, CPU-bound work — for a real
 * shop-floor DXF (thousands of entities, e.g. a laser-cut nesting sheet
 * with hundreds of parts) that can take long enough on the main thread to
 * freeze the tab entirely: confirmed live, a real user's file left the
 * dialog stuck on "Завантаження креслення…" forever (not actually hung,
 * just never getting a chance to repaint because nothing else could run
 * until the synchronous parse returned). Running it in this worker instead
 * keeps the tab responsive, mirroring `step-parser.worker.ts`'s exact
 * rationale for the STEP viewer.
 *
 * No `/// <reference lib="webworker">` here on purpose — same reason as
 * `step-parser.worker.ts`: that lib redeclares globals (`self`,
 * `postMessage`, ...) that conflict with the `dom` lib the rest of this
 * project's tsconfig already pulls in, so the worker-global APIs used
 * below go through a narrow `self as WorkerGlobal` cast instead.
 */
import DxfParser from 'dxf-parser';
import { extractSegments, computeBoundingBox, type Segment, type BBox } from './dxf-geometry';

export interface DxfParseRequest {
  text: string;
}

export type DxfParseResponse = { ok: true; segments: Segment[]; bbox: BBox } | { ok: false; error: string };

interface WorkerGlobal {
  onmessage: ((event: { data: DxfParseRequest }) => void) | null;
  postMessage(message: DxfParseResponse): void;
}

const worker = self as unknown as WorkerGlobal;

worker.onmessage = (event) => {
  try {
    const dxf = new DxfParser().parseSync(event.data.text);
    if (!dxf) throw new Error('Could not parse DXF file.');

    const segments = extractSegments(dxf);
    if (segments.length === 0) throw new Error('No supported geometry found in file.');

    worker.postMessage({ ok: true, segments, bbox: computeBoundingBox(segments) });
  } catch (err) {
    worker.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
