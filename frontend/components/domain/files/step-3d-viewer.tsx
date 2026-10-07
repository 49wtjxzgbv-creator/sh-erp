'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ChevronDown, ChevronRight, Check, AlertTriangle, Plus, Loader2 } from 'lucide-react';
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
 * Product one), EVERY named node (not just leaves — a real article often
 * sits on a parent/group node, with the actual mesh underneath carrying
 * a generic auto-generated name) is matched against it (case-insensitive,
 * trimmed, article-prefix-before-the-first-"-" as a fallback — see
 * `articleMatches`) and flagged ✅/⚠️ — a quick visual check for
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
  /**
   * "Якщо деталей якихось не має, то має бути кнопка додати до BOM
   * специфікації" + "потрібна кнопка додати все" (2026-10-08 user
   * requests): when supplied, every ⚠️ (unmatched) node gets an inline "➕"
   * next to it, and the panel header gets a bulk "add all" button — both
   * call this with the full list of article candidates to add (a single
   * article for the per-row button, every currently-unmatched candidate
   * for "add all"). Takes an ARRAY (not one article at a time) precisely so
   * the caller can resolve + append them in ONE BOM write: the caller's own
   * "existing lines" snapshot would otherwise go stale between calls if
   * this were invoked once per article back-to-back (each call would
   * overwrite the previous one's addition, since `setAssemblyComponents`
   * replaces the whole line list). Returns which of the requested articles
   * had no catalog match — those rows then offer "create product" instead
   * of silently failing. Omit entirely to read-only-gate this (no
   * caller-side `assemblies:write`, or a non-assembly file) — same
   * convention as `bomArticles` itself.
   */
  onAddToBom?: (articles: string[]) => Promise<{ notFound: string[] }>;
  /**
   * "а те чого немає в каталозі запропонувати створити новий товар"
   * (2026-10-08): offered on a row whose article came back in `notFound`
   * above. The CALLER owns the actual product-creation UI (a dialog) since
   * embedding it here would pull the whole catalog `ProductForm` into this
   * already-lazy-loaded 3D viewer chunk for no benefit — this just bubbles
   * up "the user wants to create article X, named roughly Y".
   */
  onCreateProduct?: (article: string, suggestedName: string) => void;
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

export function Step3DViewer({ url, glbUrl, bomArticles, onAddToBom, onCreateProduct }: Step3DViewerProps) {
  const t = useTranslations('files');
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const [tree, setTree] = useState<ModelTreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingArticles, setPendingArticles] = useState<Set<string>>(new Set());
  const [notFoundArticles, setNotFoundArticles] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);

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

  // Every currently-⚠️ node's best-guess article, deduped — the candidate
  // set "Додати все" (add all) sends in one shot. Recomputes whenever the
  // tree or the BOM cross-reference changes, so it stays accurate after a
  // partial add (some rows flip to ✅ and drop out automatically).
  //
  // Restricted to nodes shaped like "ARTICLE-description" (has a dash) —
  // deliberately NOT every ⚠️ node, unlike the per-row "+" button. A real
  // assembly's generic, auto-generated solid-body names (e.g.
  // "Твердое_тело1_4429") and internal CAD instance ids (e.g. "440166_1")
  // also show up as ⚠️ (the display cross-reference checks every named
  // node, on purpose — see the file header comment), and there can be
  // thousands of them in one file (a real 440158.glb here had ~18k such
  // names). Bulk-querying the catalog once per name for that many bogus
  // candidates would be slow and pointless — none of them are real
  // articles. A human clicking one specific row's own "+" still works on
  // any name, dash or not; this bulk action only fires on names that
  // actually look like the CAD export's own article convention.
  const unmatchedArticles = useMemo(() => {
    if (!bomSet) return [];
    const set = bomSet;
    const seen = new Set<string>();
    function walk(nodes: ModelTreeNode[]) {
      for (const node of nodes) {
        if (node.name && node.name.trim().indexOf('-') > 0 && !articleMatches(node.name, set)) {
          seen.add(extractArticleCandidate(node.name));
        }
        walk(node.children);
      }
    }
    walk(tree);
    return Array.from(seen);
  }, [tree, bomSet]);

  async function addArticles(articles: string[]) {
    if (!onAddToBom || articles.length === 0) return;
    setBulkError(null);
    setPendingArticles((prev) => new Set([...prev, ...articles]));
    try {
      const { notFound } = await onAddToBom(articles);
      setNotFoundArticles((prev) => new Set([...prev, ...notFound]));
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingArticles((prev) => {
        const next = new Set(prev);
        for (const a of articles) next.delete(a);
        return next;
      });
    }
  }

  return (
    // Stacked (model on top, tree below, both scrollable in their own
    // strip) below the `sm` breakpoint — a fixed w-64 side panel on a
    // phone-width dialog left almost no room for the model itself (real
    // user report, 2026-10-08: "вікно з артикулами перекриває саму
    // модель"). Side-by-side returns once there's actually room for it.
    <div className="flex h-full w-full flex-col sm:flex-row">
      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {state === 'loading' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('loadingModel')}</p>
        )}
        {state === 'error' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{t('modelLoadError')}</p>
        )}
      </div>
      {showTree && (
        <div className="flex h-40 w-full shrink-0 flex-col overflow-y-auto border-t border-border p-2 sm:h-auto sm:w-64 sm:border-t-0 sm:border-l">
          {onAddToBom && unmatchedArticles.length > 0 && (
            <button
              type="button"
              onClick={() => addArticles(unmatchedArticles)}
              disabled={pendingArticles.size > 0}
              className="mb-2 flex shrink-0 items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-secondary/50 disabled:opacity-50"
            >
              {pendingArticles.size > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {t('addAllToBom', { count: unmatchedArticles.length })}
            </button>
          )}
          {bulkError && <p className="mb-2 shrink-0 text-xs text-destructive">{bulkError}</p>}
          <ModelTreeList
            nodes={tree}
            selectedId={selectedId}
            onSelect={setSelectedId}
            bomSet={bomSet}
            onAddToBom={onAddToBom ? addArticles : undefined}
            pendingArticles={pendingArticles}
            notFoundArticles={notFoundArticles}
            onCreateProduct={onCreateProduct}
          />
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
  onAddToBom,
  pendingArticles,
  notFoundArticles,
  onCreateProduct,
}: {
  nodes: ModelTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  bomSet: Set<string> | null;
  onAddToBom?: (articles: string[]) => void;
  pendingArticles: Set<string>;
  notFoundArticles: Set<string>;
  onCreateProduct?: (article: string, suggestedName: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <ModelTreeRow
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          bomSet={bomSet}
          onAddToBom={onAddToBom}
          pendingArticles={pendingArticles}
          notFoundArticles={notFoundArticles}
          onCreateProduct={onCreateProduct}
        />
      ))}
    </ul>
  );
}

function ModelTreeRow({
  node,
  selectedId,
  onSelect,
  bomSet,
  onAddToBom,
  pendingArticles,
  notFoundArticles,
  onCreateProduct,
}: {
  node: ModelTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  bomSet: Set<string> | null;
  onAddToBom?: (articles: string[]) => void;
  pendingArticles: Set<string>;
  notFoundArticles: Set<string>;
  onCreateProduct?: (article: string, suggestedName: string) => void;
}) {
  const t = useTranslations('files');
  const [open, setOpen] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);
  const isSelected = node.id === selectedId;
  const hasChildren = node.children.length > 0;
  // Not restricted to leaves: a real article often sits on a PARENT/group
  // node, with the actual mesh underneath carrying a generic, auto-
  // generated name (e.g. "263803-Stirnzahnrad_..." as the parent, with a
  // child literally named "Твердое_тело1_4429") — 2026-10-08 user report,
  // a real file where isLeaf-only matching silently never checked the one
  // node that actually had the article.
  const matched = bomSet && node.name ? articleMatches(node.name, bomSet) : null;
  const article = node.name ? extractArticleCandidate(node.name) : '';
  const adding = pendingArticles.has(article);
  const notInCatalog = notFoundArticles.has(article);

  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    onAddToBom?.([article]);
  }

  function handleCreateProduct(e: React.MouseEvent) {
    e.stopPropagation();
    onCreateProduct?.(article, suggestProductName(node.name));
  }

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
        {matched === false && (
          <>
            <span title={notInCatalog ? undefined : article}>
              <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
            </span>
            {notInCatalog && onCreateProduct ? (
              <button
                type="button"
                onClick={handleCreateProduct}
                className="shrink-0 whitespace-nowrap rounded text-[11px] text-primary hover:underline"
              >
                {t('createProduct')}
              </button>
            ) : (
              onAddToBom && (
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding}
                  className="shrink-0 rounded text-muted-foreground hover:text-primary disabled:opacity-50"
                  aria-label="+"
                >
                  {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </button>
              )
            )}
          </>
        )}
      </div>
      {open && hasChildren && (
        <div className="ml-3 border-l border-border/50 pl-1.5">
          <ModelTreeList
            nodes={node.children}
            selectedId={selectedId}
            onSelect={onSelect}
            bomSet={bomSet}
            onAddToBom={onAddToBom}
            pendingArticles={pendingArticles}
            notFoundArticles={notFoundArticles}
            onCreateProduct={onCreateProduct}
          />
        </div>
      )}
    </li>
  );
}

/** Best-guess article for the "➕ add to BOM" action — mirrors `articleMatches`' own fallback: prefer the dash-prefix when present (the far more common "ARTICLE-description" shape), else the full trimmed name. */
function extractArticleCandidate(name: string): string {
  const trimmed = name.trim();
  const dashIndex = trimmed.indexOf('-');
  return dashIndex > 0 ? trimmed.slice(0, dashIndex).trim() : trimmed;
}

/** Rough product-name guess for the "create product" prefill: everything after the article's dash, with CAD-export underscores turned back into spaces — just a starting point the user edits in the create form, not meant to be exact. */
function suggestProductName(name: string): string {
  const trimmed = name.trim();
  const dashIndex = trimmed.indexOf('-');
  const rest = dashIndex > 0 ? trimmed.slice(dashIndex + 1) : trimmed;
  return rest.trim().replace(/_/g, ' ');
}

function treeHasNames(nodes: ModelTreeNode[]): boolean {
  return nodes.some((n) => Boolean(n.name.trim()) || treeHasNames(n.children));
}

/**
 * A glTF node's name is rarely JUST the article — a real-world example
 * (2026-10-08 user report) is `"278807-Flachstahl_EST;_120_x_..."`:
 * article, then a bare `-` (no surrounding spaces), then the part's own
 * name. Tries the full trimmed name first (covers a node that genuinely
 * IS only the article), then falls back to everything before the FIRST
 * `-` — every real article seen in this app so far uses `_`/`.` instead
 * of `-` internally (e.g. "288171_172_173", "264084.02"), so splitting on
 * the first `-` is a safe, if heuristic, way to isolate it.
 */
function articleMatches(name: string, bomSet: Set<string>): boolean {
  const trimmed = name.trim();
  if (bomSet.has(trimmed.toUpperCase())) return true;
  const dashIndex = trimmed.indexOf('-');
  if (dashIndex > 0) {
    const prefix = trimmed.slice(0, dashIndex).trim();
    if (bomSet.has(prefix.toUpperCase())) return true;
  }
  return false;
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
