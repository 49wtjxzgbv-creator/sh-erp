'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { OcctReadResult } from 'occt-import-js';
import type { StepParseRequest, StepParseResponse } from './step-parser.worker';

/**
 * Renders a STEP (.step/.stp) CAD file in-browser.
 *
 * Two paths, chosen by whether `glbUrl` is passed:
 *
 * - **Fast path (`glbUrl` present)**: the backend's `StepConversionService`
 *   already converted this document to a small pre-tessellated `.glb` once,
 *   server-side, at upload time. Loaded here with three.js's own
 *   `GLTFLoader` — no WASM, no CAD parsing, effectively instant regardless
 *   of the original STEP file's size or complexity. This is the path every
 *   document takes once conversion finishes.
 * - **Fallback path (`glbUrl` absent)**: conversion hasn't finished yet (or
 *   failed) — parses the raw STEP client-side via `occt-import-js` (a WASM
 *   build of OpenCascade, the same parser the open-source Online3DViewer
 *   project uses), converting it into plain triangle meshes. The actual
 *   parse runs in `step-parser.worker.ts`, not on the main thread — for a
 *   real multi-part assembly that's synchronous WASM work that can take
 *   minutes, and running it inline froze the whole tab for that entire
 *   duration (looked exactly like "hung forever" to a real user testing a
 *   real file, even though it would have finished eventually). A hard
 *   `PARSE_TIMEOUT_MS` below turns a truly pathological file into a clear
 *   error instead of an unbounded wait either way.
 *
 * Both paths share the same scene/camera/lighting/controls setup
 * (`mountScene` below) — only how the initial `THREE.Object3D` is obtained
 * differs.
 *
 * Loaded lazily via `next/dynamic` from `entity-documents-field.tsx`
 * (`ssr: false`) so three.js and (on the fallback path) the ~7MB WASM
 * module never enter any page's main bundle — only fetched the moment
 * someone actually opens a .step file.
 *
 * `OrbitControls` handles mouse AND touch out of the box (one-finger
 * rotate, two-finger pinch-zoom/pan on mobile) — no separate mobile code
 * path needed for the "зручний і на мобільних" requirement.
 */
export interface Step3DViewerProps {
  /** Presigned download URL for the raw .step/.stp file — used only when `glbUrl` is absent. */
  url: string;
  /** Presigned download URL for the pre-converted .glb, when available. */
  glbUrl?: string;
}

type ViewerState = 'loading' | 'ready' | 'error';

/**
 * A real multi-part mechanical assembly (tens of MB) can legitimately take
 * several minutes to tessellate in single-threaded WASM — confirmed via a
 * real 16.6MB file that was still genuinely parsing (not stuck: the worker
 * keeps posting no message because the synchronous OCCT call hadn't
 * returned yet) well past an earlier, too-aggressive 3-minute cutoff. This
 * only matters for the fallback path (server-side conversion pending or
 * failed) — it's deliberately generous, existing only to turn a truly
 * pathological file into an eventual error instead of a silent unbounded
 * wait, not to rush normal large-file parsing.
 */
const PARSE_TIMEOUT_MS = 10 * 60 * 1000;

export function Step3DViewer({ url, glbUrl }: Step3DViewerProps) {
  const t = useTranslations('files');
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ViewerState>('loading');

  useEffect(() => {
    let cancelled = false;
    let disposeScene: (() => void) | undefined;
    let worker: Worker | undefined;

    async function init() {
      const container = containerRef.current;
      if (!container) return;

      setState('loading');
      try {
        const group = glbUrl ? await loadGlb(glbUrl) : await loadStepViaWorker(url, (w) => (worker = w));
        if (cancelled) return;

        disposeScene = mountScene(container, group);
        setState('ready');
      } catch (err) {
        console.error('[Step3DViewer] failed to load/render model:', err);
        if (!cancelled) setState('error');
      }
    }

    init();

    return () => {
      cancelled = true;
      worker?.terminate();
      disposeScene?.();
    };
  }, [url, glbUrl]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {state === 'loading' && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('loadingModel')}</p>
      )}
      {state === 'error' && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{t('modelLoadError')}</p>
      )}
    </div>
  );
}

async function loadGlb(glbUrl: string): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return gltf.scene;
}

async function loadStepViaWorker(url: string, onWorker: (worker: Worker) => void): Promise<THREE.Object3D> {
  const buffer = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Failed to download model (${r.status})`);
    return r.arrayBuffer();
  });

  const result = await parseInWorker(buffer, onWorker);
  if (!result.success || result.meshes.length === 0) {
    throw new Error('No geometry found in file.');
  }

  const group = new THREE.Group();
  for (const mesh of result.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
    if (mesh.attributes.normal) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3));
    } else {
      geometry.computeVertexNormals();
    }
    geometry.setIndex(mesh.index.array);

    const color = mesh.color ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]) : new THREE.Color(0x9ca3af);
    const material = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.7, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}

/**
 * Frames, lights, and renders `group` into `container` — shared by both the
 * fast (`.glb`) and fallback (raw STEP) load paths, which differ only in
 * how they produce this `THREE.Object3D`. Returns a cleanup function.
 */
function mountScene(container: HTMLDivElement, group: THREE.Object3D): () => void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f4f6);
  scene.add(group);

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  group.position.sub(center);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(maxDim, maxDim, maxDim);
  scene.add(dirLight);

  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, width / height, maxDim / 1000, maxDim * 100);
  camera.position.set(maxDim * 1.2, maxDim * 1.2, maxDim * 1.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  let animationFrame: number | undefined;
  function animate() {
    animationFrame = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(container);

  return () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

/**
 * Runs the actual parse in `step-parser.worker.ts`, transferring the file
 * bytes into the worker (zero-copy) rather than copying them. `onWorker`
 * hands the created `Worker` back to the caller immediately so it can be
 * terminated on unmount even while a parse is still in flight.
 */
function parseInWorker(buffer: ArrayBuffer, onWorker: (worker: Worker) => void): Promise<OcctReadResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./step-parser.worker.ts', import.meta.url));
    onWorker(worker);

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Parsing timed out.'));
    }, PARSE_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<StepParseResponse>) => {
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Worker error.'));
    };

    const request: StepParseRequest = { buffer };
    worker.postMessage(request, [buffer]);
  });
}
