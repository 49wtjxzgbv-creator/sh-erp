'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ChevronDown, ChevronRight, Check, AlertTriangle } from 'lucide-react';
import type { OcctReadResult } from 'occt-import-js';
import type { StepParseRequest, StepParseResponse } from './step-parser.worker';
import { cn } from '@/lib/utils';

/**
 * Renders a STEP (.step/.stp) or glTF (.glb) CAD file in-browser.
 *
 * Two paths, chosen by whether `glbUrl` is passed:
 *
 * - **Fast path (`glbUrl` present)**: either the backend's
 *   `StepConversionService` already converted this document to a small
 *   pre-tessellated `.glb` once, server-side, at upload time, OR the user
 *   uploaded a `.glb` directly (no conversion needed at all). Loaded here
 *   with three.js's own `GLTFLoader` — no WASM, no CAD parsing, effectively
 *   instant.
 * - **Fallback path (`glbUrl` absent)**: a raw STEP whose conversion hasn't
 *   finished yet (or failed) — parsed client-side via `occt-import-js` (a
 *   WASM build of OpenCascade). Runs in `step-parser.worker.ts`, not on the
 *   main thread. A hard `PARSE_TIMEOUT_MS` turns a truly pathological file
 *   into a clear error instead of an unbounded wait.
 *
 * **Component tree + BOM cross-reference** (2026-10-08 user request —
 * "наші користувачі будуть завантажувати файли .glb, які містять
 * інженерну ієрархію компонентів та артикули деталей"): glTF nodes carry
 * names (OCCT's own STEP product names survive the conversion unchanged —
 * see step-convert-child.js — and a hand-authored CAD export typically
 * names each node by its own part number/article). `buildTree` mirrors
 * that node hierarchy into a side panel; clicking an entry highlights the
 * matching mesh(es) in the 3D view, and clicking a mesh in the 3D view
 * highlights its entry in the tree (via `userData.__treeNodeId`, set on
 * every node while building the tree). The panel only renders at all when
 * at least one node actually has a name — a flat, unnamed mesh soup (e.g.
 * the client-side WASM fallback path, which never names anything) shows
 * the plain viewer exactly as before.
 *
 * When `bomArticles` is supplied (the assembly's own current BOM product
 * articles — only the ASSEMBLY caller passes this, never the generic
 * Product one), each LEAF node's name is matched against it
 * (case-insensitive, trimmed) and flagged ✅/⚠️ — a quick visual check for
 * "does this 3D model's parts list line up with what's actually in the
 * specification". This is a convenience cross-reference, not a data
 * source: it never writes back to the BOM, and a mismatch only means the
 * NAME didn't match, not necessarily that the part is actually missing —
 * reliable only as far as the CAD export's own naming convention lines up
 * with real article numbers.
 *
 * Loaded lazily via `next/dynamic` from `entity-documents-field.tsx`
 * (`ssr: false`) so three.js and (on the fallback path) the ~7MB WASM
 * module never enter any page's main bundle.
 *
 * `OrbitControls` handles mouse AND touch out of the box (one-finger
 * rotate, two-finger pinch-zoom/pan on mobile) — no separate mobile code
 * path needed for the "зручний і на мобільних" requirement.
 */
export interface Step3DViewerProps {
  /** Presigned download URL for the raw .step/.stp file — used only when `glbUrl` is absent. */
  url: string;
  /** Presigned download URL for a .glb — either pre-converted server-side, or the file itself when it's already a .glb. */
  glbUrl?: string;
  /** The hosting assembly's current BOM product articles, for the optional ✅/⚠️ cross-reference — omit entirely for a non-assembly (e.g. Product) file. */
  bomArticles?: string[];
}

type ViewerState = 'loading' | 'ready' | 'error';

interface ModelTreeNode {
  id: string;
  name: string;
  isLeaf: boolean;
  children: ModelTreeNode[];
}

interface SceneApi {
  dispose: () => void;
  setSelected: (id: string | null) => void;
}

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

const HIGHLIGHT_EMISSIVE = new THREE.Color(0xf59e0b); // amber-500 — distinct from typical CAD greys/blues

export function Step3DViewer({ url, glbUrl, bomArticles }: Step3DViewerProps) {
  const t = useTranslations('files');
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const [tree, setTree] = useState<ModelTreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let disposeScene: (() => void) | undefined;
    let worker: Worker | undefined;

    async function init() {
      const container = containerRef.current;
      if (!container) return;

      setState('loading');
      setTree([]);
      setSelectedId(null);
      try {
        const group = glbUrl ? await loadGlb(glbUrl) : await loadStepViaWorker(url, (w) => (worker = w));
        if (cancelled) return;

        const builtTree = buildTree(group);
        setTree(builtTree);

        const api = mountScene(container, group, (id) => setSelectedId(id));
        sceneApiRef.current = api;
        disposeScene = api.dispose;
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
      sceneApiRef.current = null;
    };
  }, [url, glbUrl]);

  useEffect(() => {
    sceneApiRef.current?.setSelected(selectedId);
  }, [selectedId]);

  const bomSet = useMemo(
    () => (bomArticles ? new Set(bomArticles.map((a) => a.trim().toUpperCase()).filter(Boolean)) : null),
    [bomArticles],
  );
  const showTree = state === 'ready' && treeHasNames(tree);

  return (
    <div className="flex h-full w-full">
      <div className="relative min-w-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {state === 'loading' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('loadingModel')}</p>
        )}
        {state === 'error' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{t('modelLoadError')}</p>
        )}
      </div>
      {showTree && (
        <div className="w-64 shrink-0 overflow-y-auto border-l border-border p-2">
          <ModelTreeList nodes={tree} selectedId={selectedId} onSelect={setSelectedId} bomSet={bomSet} />
        </div>
      )}
    </div>
  );
}

function ModelTreeList({
  nodes,
  selectedId,
  onSelect,
  bomSet,
}: {
  nodes: ModelTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  bomSet: Set<string> | null;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <ModelTreeRow key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} bomSet={bomSet} />
      ))}
    </ul>
  );
}

function ModelTreeRow({
  node,
  selectedId,
  onSelect,
  bomSet,
}: {
  node: ModelTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  bomSet: Set<string> | null;
}) {
  const [open, setOpen] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);
  const isSelected = node.id === selectedId;
  const hasChildren = node.children.length > 0;
  const matched = bomSet && node.isLeaf && node.name ? bomSet.has(node.name.trim().toUpperCase()) : null;

  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);

  return (
    <li>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(node.id); }}
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-secondary/50',
          isSelected && 'bg-primary/10 font-medium text-primary',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            className="shrink-0 text-muted-foreground"
            aria-label={open ? '-' : '+'}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate" title={node.name}>
          {node.name || '—'}
        </span>
        {matched === true && <Check className="h-3 w-3 shrink-0 text-success" />}
        {matched === false && <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />}
      </div>
      {open && hasChildren && (
        <div className="ml-3 border-l border-border/50 pl-1.5">
          <ModelTreeList nodes={node.children} selectedId={selectedId} onSelect={onSelect} bomSet={bomSet} />
        </div>
      )}
    </li>
  );
}

function treeHasNames(nodes: ModelTreeNode[]): boolean {
  return nodes.some((n) => Boolean(n.name.trim()) || treeHasNames(n.children));
}

/**
 * Mirrors `group`'s own child hierarchy into a plain tree, assigning each
 * `Object3D` a stable id (stashed on `userData.__treeNodeId` so a raycast
 * hit can be mapped straight back to a tree entry). Every mesh's material
 * is cloned once here too (never mutated in place) — glTF commonly shares
 * one material across many meshes to save memory, and highlighting a
 * shared material would wrongly light up every part using it.
 */
let treeNodeIdCounter = 0;
function buildTree(group: THREE.Object3D): ModelTreeNode[] {
  function walk(object: THREE.Object3D): ModelTreeNode {
    const id = `tree-${treeNodeIdCounter++}`;
    object.userData.__treeNodeId = id;
    if (object instanceof THREE.Mesh) {
      object.material = Array.isArray(object.material) ? object.material.map((m) => m.clone()) : object.material.clone();
    }
    return {
      id,
      name: object.name ?? '',
      isLeaf: object.children.length === 0,
      children: object.children.map(walk),
    };
  }
  return group.children.map(walk);
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
    const meshObj = new THREE.Mesh(geometry, material);
    if (mesh.name) meshObj.name = mesh.name;
    group.add(meshObj);
  }
  return group;
}

/**
 * Frames, lights, and renders `group` into `container` — shared by both
 * load paths. Also wires up click-to-select: a raycast hit is mapped back
 * to a tree node id via `userData.__treeNodeId` (set by `buildTree` on
 * every object, so even a nested child mesh resolves immediately — no
 * need to walk up parents) and reported through `onPick`. Returns both a
 * cleanup function and `setSelected`, so the caller's React state can
 * drive the 3D highlight in either direction (tree click -> 3D highlight,
 * or 3D click -> tree selection, both end up calling the same `setSelected`).
 */
function mountScene(container: HTMLDivElement, group: THREE.Object3D, onPick: (id: string | null) => void): SceneApi {
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

  // ---- click-to-select / highlight ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let highlighted: THREE.Mesh[] = [];

  function meshesUnder(object: THREE.Object3D): THREE.Mesh[] {
    const found: THREE.Mesh[] = [];
    object.traverse((o) => { if (o instanceof THREE.Mesh) found.push(o); });
    return found;
  }
  function applyHighlight(mesh: THREE.Mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if ('emissive' in mat) (mat as THREE.MeshStandardMaterial).emissive.copy(HIGHLIGHT_EMISSIVE);
    }
  }
  function clearHighlight(mesh: THREE.Mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if ('emissive' in mat) (mat as THREE.MeshStandardMaterial).emissive.set(0x000000);
    }
  }
  function setSelected(id: string | null) {
    highlighted.forEach(clearHighlight);
    highlighted = [];
    if (!id) return;
    const target = findByTreeId(group, id);
    if (!target) return;
    highlighted = meshesUnder(target);
    highlighted.forEach(applyHighlight);
  }

  function onClick(e: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(group, true);
    onPick(hits.length > 0 ? (hits[0].object.userData.__treeNodeId as string | undefined) ?? null : null);
  }
  renderer.domElement.addEventListener('click', onClick);

  return {
    setSelected,
    dispose: () => {
      renderer.domElement.removeEventListener('click', onClick);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function findByTreeId(root: THREE.Object3D, id: string): THREE.Object3D | null {
  if (root.userData.__treeNodeId === id) return root;
  for (const child of root.children) {
    const found = findByTreeId(child, id);
    if (found) return found;
  }
  return null;
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
