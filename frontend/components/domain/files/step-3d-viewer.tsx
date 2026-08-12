'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { OcctReadResult } from 'occt-import-js';
import type { StepParseRequest, StepParseResponse } from './step-parser.worker';

/**
 * Renders a STEP (.step/.stp) CAD file in-browser. STEP is a B-rep CAD
 * format, not a mesh format three.js can load directly — `occt-import-js`
 * (a WASM build of OpenCascade, the same parser the open-source
 * Online3DViewer project uses) converts it into plain triangle meshes,
 * which are then handed to a normal three.js scene. Loaded lazily via
 * `next/dynamic` from `entity-documents-field.tsx` (`ssr: false`) so this
 * ~7MB WASM module and the three.js runtime never enter any page's main
 * bundle — only fetched the moment someone actually opens a .step file.
 *
 * The actual CAD parse (`ReadStepFile`) runs in `step-parser.worker.ts`,
 * not here — for a real multi-part assembly that's synchronous WASM work
 * that can take a long time, and running it on the main thread froze the
 * whole tab for that entire duration (looked exactly like "hung forever"
 * to a real user testing a real file, even though it would have finished
 * eventually). The worker keeps the tab responsive while it parses; a
 * hard `PARSE_TIMEOUT_MS` below turns a truly pathological file into a
 * clear error instead of an unbounded wait either way.
 *
 * `OrbitControls` handles mouse AND touch out of the box (one-finger
 * rotate, two-finger pinch-zoom/pan on mobile) — no separate mobile code
 * path needed for the "зручний і на мобільних" requirement.
 */
export interface Step3DViewerProps {
  /** Presigned download URL for the .step/.stp file. */
  url: string;
}

type ViewerState = 'loading' | 'ready' | 'error';

/**
 * A real multi-part mechanical assembly (tens of MB) can legitimately take
 * several minutes to tessellate in single-threaded WASM — confirmed via a
 * real 16.6MB file that was still genuinely parsing (not stuck: the worker
 * keeps posting no message because the synchronous OCCT call hadn't
 * returned yet) well past an earlier, too-aggressive 3-minute cutoff. This
 * is deliberately generous — it exists only to turn a truly pathological
 * file (corrupt data, infinite loop) into an eventual error instead of a
 * silent unbounded wait, not to rush normal large-file parsing.
 */
const PARSE_TIMEOUT_MS = 10 * 60 * 1000;

export function Step3DViewer({ url }: Step3DViewerProps) {
  const t = useTranslations('files');
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ViewerState>('loading');

  useEffect(() => {
    let cancelled = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let animationFrame: number | undefined;
    let worker: Worker | undefined;

    async function init() {
      const container = containerRef.current;
      if (!container) return;

      setState('loading');
      try {
        const response = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`Failed to download model (${r.status})`);
          return r.arrayBuffer();
        });
        if (cancelled) return;

        const result = await parseInWorker(response, (w) => {
          worker = w;
        });
        if (cancelled) return;
        if (!result.success || result.meshes.length === 0) {
          throw new Error('No geometry found in file.');
        }

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf3f4f6);

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

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        container.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0, 0);

        function animate() {
          animationFrame = requestAnimationFrame(animate);
          controls?.update();
          if (renderer) renderer.render(scene, camera);
        }
        animate();

        resizeObserver = new ResizeObserver(() => {
          const w = container.clientWidth || 1;
          const h = container.clientHeight || 1;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer?.setSize(w, h);
        });
        resizeObserver.observe(container);

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
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      controls?.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [url]);

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
