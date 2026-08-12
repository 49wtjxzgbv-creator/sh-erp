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
import type { OcctReadResult } from 'occt-import-js';

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
    const result = occt.ReadStepFile(new Uint8Array(event.data.buffer), null);
    worker.postMessage({ ok: true, result });
  } catch (err) {
    worker.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
