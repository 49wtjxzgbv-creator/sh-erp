/**
 * occt-import-js's `ReadStepFile` is synchronous WASM work — for a real
 * mechanical assembly (thousands of faces) that can run long enough to
 * freeze the tab's main thread entirely, which looks indistinguishable
 * from "hung" (the already-painted "завантаження 3D-моделі…" text just
 * sits there, unable to repaint, because nothing else can run until the
 * parse returns). Running it in this worker instead keeps the tab
 * responsive — parsing still takes as long as it takes, but the UI stays
 * alive and the result still arrives.
 *
 * No `/// <reference lib="webworker">` here on purpose — that lib
 * redeclares globals (`self`, `postMessage`, ...) that conflict with the
 * `dom` lib the rest of this project's tsconfig already pulls in, so the
 * worker-global APIs used below are accessed through a narrow `self as
 * WorkerGlobal` cast instead of typing the whole ambient scope.
 */
import type { OcctReadParams, OcctReadResult } from 'occt-import-js';

/**
 * `null` params means OCCT's own default tessellation quality, which is
 * tuned for CAD precision, not for a quick shop-floor preview — on a real
 * 16.6MB multi-part assembly it made `ReadStepFile` take several minutes.
 * A visibly coarser mesh (well above OCCT's default sub-0.1% precision)
 * cuts the triangle count enormously and is plenty for "what does this
 * part look like" in this app; nothing here needs machining-grade
 * surface accuracy.
 *
 * Scaled by input file size — kept in sync with
 * `step-convert-child.js#pickTessellationParams` on the backend (see that
 * function's header comment for why: file size alone doesn't measure
 * tessellation cost, but it's the only cheap signal available before
 * parsing, and in practice a bigger STEP text blob generally means more
 * individual solids, e.g. bolts/threads, which is what actually drives
 * triangle count and — for this client-side path specifically — how long
 * the fallback viewer takes to render at all).
 */
function pickTessellationParams(stepFileSizeBytes: number): OcctReadParams {
  const MB = 1024 * 1024;
  if (stepFileSizeBytes < 5 * MB) {
    return { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.01, angularDeflection: 0.5 };
  }
  if (stepFileSizeBytes < 15 * MB) {
    return { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.03, angularDeflection: 0.8 };
  }
  return { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.06, angularDeflection: 1.2 };
}

export interface StepParseRequest {
  buffer: ArrayBuffer;
}

export type StepParseResponse = { ok: true; result: OcctReadResult } | { ok: false; error: string };

interface WorkerGlobal {
  onmessage: ((event: { data: StepParseRequest }) => void) | null;
  postMessage(message: StepParseResponse): void;
}

const worker = self as unknown as WorkerGlobal;

let occtPromise: ReturnType<typeof init> | undefined;

async function init() {
  const { default: occtimportjs } = await import('occt-import-js');
  return occtimportjs({ locateFile: () => '/occt/occt-import-js.wasm' });
}

worker.onmessage = async (event) => {
  try {
    if (!occtPromise) occtPromise = init();
    const occt = await occtPromise;
    const result = occt.ReadStepFile(new Uint8Array(event.data.buffer), pickTessellationParams(event.data.buffer.byteLength));
    worker.postMessage({ ok: true, result });
  } catch (err) {
    worker.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
