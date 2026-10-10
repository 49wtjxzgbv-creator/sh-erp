'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { ChevronDown, ChevronRight, ChevronUp, Check, AlertTriangle, Plus, Loader2, Search, X, Eye, EyeOff, Expand, Shrink } from 'lucide-react';
import type { OcctReadResult } from 'occt-import-js';
import type { StepParseRequest, StepParseResponse } from './step-parser.worker';
import { cn } from '@/lib/utils';
import { ArViewButton } from './ar-view-button';

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
  /**
   * "показується не весь виріб а по одній деталі" (2026-10-10): the SAME
   * model, but the de-instanced (`arOptimizedDownloadUrl`) variant —
   * `instance()`'s `EXT_mesh_gpu_instancing` (used in `glbUrl` above
   * whenever present) silently drops every duplicate part when
   * `@google/model-viewer` converts to USDZ for iOS AR Quick Look, so the
   * whole-model AR button (nothing selected) needs its own, separately
   * presigned URL rather than reusing `glbUrl`. Falls back to `glbUrl`
   * itself while this variant is still pending/was never generated (a
   * `.step`-converted file, for instance, never goes through
   * GlbOptimizationService at all and is already AR-safe as-is).
   */
  arGlbUrl?: string;
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
   * replaces the whole line list). Each item's `qty` is how many TIMES that
   * article's node appears in the model tree — "однієї позиції там може
   * бути декілька штук" (2026-10-08 user report: the model tree often has
   * the same article on several separate instance nodes, e.g. 4 identical
   * bolts, and the BOM line needs qtyPerUnit 4, not 1) — see
   * `unmatchedArticleCounts` for how this is computed. Returns which of the
   * requested articles had no catalog match — those rows then offer
   * "create product" instead of silently failing. Omit entirely to
   * read-only-gate this (no caller-side `assemblies:write`, or a
   * non-assembly file) — same convention as `bomArticles` itself.
   */
  onAddToBom?: (items: { article: string; qty: number }[]) => Promise<{ notFound: string[] }>;
  /**
   * "а те чого немає в каталозі запропонувати створити новий товар" +
   * "потрібно щоб воно робило фото саме цієї деталі і додавало" +
   * "потрібно також... щоб до товару додавало gbl файл саме цієї позиції
   * якої робить фото" (2026-10-08): offered on a row whose article came
   * back in `notFound` above. The CALLER owns the actual product-creation
   * UI (a dialog) since embedding it here would pull the whole catalog
   * `ProductForm` into this already-lazy-loaded 3D viewer chunk for no
   * benefit — this just bubbles up "the user wants to create article X,
   * named roughly Y, qty Z" (same node-count-based qty as `onAddToBom`, so
   * the line it gets appended to once created has the right quantity
   * too), plus:
   * - a PNG data URL snapshot of just that one part — isolated (every
   *   other mesh hidden) and framed tight on its own bounding box,
   *   captured from the live scene right before the callback fires (see
   *   `mountScene`'s own `captureSnapshot`) — `null` only if the node
   *   turned out to have no mesh geometry under it.
   * - that same part's own geometry, re-exported as a standalone binary
   *   .glb (see `mountScene`'s own `exportPartGlb`) — so the new product
   *   ends up with both a quick photo AND a real, independently-viewable
   *   3D model of just that part, not the whole assembly it came from.
   *   Also `null` only when there's no geometry to export.
   * - that same part's own solid volume in mm³ (see `computeMeshVolume`)
   *   — "якби я вказував що це за матеріал... воно б рахувало його вагу
   *   залежно від обєму і матеріалу" (2026-10-08): lets the create-product
   *   form offer a material picker that turns this into a weight estimate
   *   (volume × density) instead of the user having to weigh or guess it.
   *   `null` only when there's no geometry to measure.
   */
  onCreateProduct?: (
    article: string,
    suggestedName: string,
    qty: number,
    photoDataUrl: string | null,
    glb: ArrayBuffer | null,
    volumeMm3: number | null,
  ) => void;
  /**
   * "Камера та Примірка (AR)" (2026-10-10): a floating "Увімкнути камеру"
   * button always sits over the canvas whenever `glbUrl` is present —
   * with nothing selected (or this prop omitted entirely) it opens AR on
   * the WHOLE assembly straight from `glbUrl` itself, no callback needed.
   * Selecting a node narrows it down to just that one part instead, but
   * only when this prop IS supplied: the CALLER resolves `article` against
   * the catalog and returns a real, publicly-fetchable download URL
   * (Android's Scene Viewer can't use a page-scoped `blob:` one — see
   * `ArViewButton`'s own header comment), `null` if there's no matching
   * product to attach a GLB to (the caller is expected to toast its own
   * explanation in that case, same convention as `onCreateProduct`'s
   * sibling dialog owning its own errors). `glb` is this node's own
   * standalone export (`mountScene`'s `exportPartGlb`), already produced
   * here for the exact same reason `onCreateProduct` gets one — so the
   * caller never needs to reach back into the live scene itself.
   */
  onActivateAr?: (article: string, name: string, glb: ArrayBuffer | null) => Promise<string | null>;
}

type ViewerState = 'loading' | 'ready' | 'error';

interface ModelTreeNode {
  id: string;
  name: string;
  isLeaf: boolean;
  children: ModelTreeNode[];
  /**
   * "відображає неправильно потрібну кількість товарів" (2026-10-09):
   * GlbOptimizationService's instancing collapses every duplicate
   * occurrence of a repeated part into ONE surviving named node (the
   * rest become anonymous instance-buffer entries — see
   * glb-optimize-child.js's own header comment) — so simply counting how
   * many tree nodes share an article name, which used to equal the real
   * quantity, now always comes out to 1 for an optimized file. The
   * backend stamps the real original count onto that one surviving
   * node's glTF `extras` (`shQty`) before instancing runs; GLTFLoader
   * merges `extras` straight into `object.userData` (confirmed in its own
   * source), so it's just read through here. `undefined` for anything
   * that was never optimized — every qty-counting walk below falls back
   * to its original "count matching nodes" behavior in that case.
   */
  qtyOverride?: number;
}

interface SceneApi {
  dispose: () => void;
  /** `instanceId` — see `focusCameraOn`'s own header comment — only ever comes from a raycast hit on an instanced batch; omit for a list-row selection (there's no single instance to point at). */
  setSelected: (id: string | null, instanceId?: number) => void;
  /** "додай кнопку приховати все і залишити показ саме цієї деталі" (2026-10-08) — hides every mesh except the current selection's own; re-applies automatically if the selection changes while still enabled. No-op (shows everything) whenever nothing is selected. */
  setIsolated: (enabled: boolean) => void;
  /** "просто подивитись анімацію" (2026-10-09) — eases every top-level node out along its own direction from the assembly's center (`true`) or back to its real assembled position (`false`). Idempotent — calling with the same value mid-animation just lets the current tween keep going. */
  setExploded: (enabled: boolean) => void;
  captureSnapshot: (id: string) => string | null;
  exportPartGlb: (id: string) => Promise<ArrayBuffer | null>;
  computeVolume: (id: string) => number | null;
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

export function Step3DViewer({ url, glbUrl, arGlbUrl, bomArticles, onAddToBom, onCreateProduct, onActivateAr }: Step3DViewerProps) {
  const t = useTranslations('files');
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const [tree, setTree] = useState<ModelTreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "коли натискаєш на одну деталь воно виділяє всі однотипні деталі"
  // (2026-10-09) — see `focusCameraOn`'s own comment (step-3d-viewer.tsx)
  // for the full "why". Only ever set from a direct 3D raycast click on
  // an instanced batch; every other selection path (list row, search)
  // explicitly clears it back to `undefined` — a stale instanceId left
  // over from a PREVIOUS click would point the camera at the wrong spot.
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | undefined>(undefined);
  /** Every selection path EXCEPT the 3D raycast click (list row, search) goes through here — always clears any instanceId left over from a previous click. */
  function selectTreeNode(id: string | null) {
    setSelectedId(id);
    setSelectedInstanceId(undefined);
  }
  const [isolateMode, setIsolateMode] = useState(false);
  const [explodedMode, setExplodedMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
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
      setSelectedInstanceId(undefined);
      setIsolateMode(false);
      setExplodedMode(false);
      try {
        const group = glbUrl ? await loadGlb(glbUrl) : await loadStepViaWorker(url, (w) => (worker = w));
        if (cancelled) return;

        const builtTree = buildTree(group);
        setTree(builtTree);

        const api = mountScene(container, group, (id, instanceId) => {
          setSelectedId(id);
          setSelectedInstanceId(instanceId);
        });
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
    sceneApiRef.current?.setSelected(selectedId, selectedInstanceId);
  }, [selectedId, selectedInstanceId]);

  useEffect(() => {
    sceneApiRef.current?.setIsolated(isolateMode);
  }, [isolateMode]);

  useEffect(() => {
    sceneApiRef.current?.setExploded(explodedMode);
  }, [explodedMode]);

  // "коли ми відкриваємо у специфікації gbl файл і там він складається з
  // багатьох позицій додай пошук... ввожу код і підсвічується потрібна
  // деталь" (2026-10-08): every tree row with a matching name, in tree
  // order — NOT deduped by article (unlike `analyzeGlbParts`'s own
  // candidate list), since this is searching the INTERACTIVE tree, where
  // a repeated article genuinely has one row per physical instance and
  // the user may want to jump to any specific one of them, not just "the"
  // article as a concept.
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const matches: string[] = [];
    function walk(nodes: ModelTreeNode[]) {
      for (const node of nodes) {
        if (node.name && node.name.toLowerCase().includes(query)) matches.push(node.id);
        walk(node.children);
      }
    }
    walk(tree);
    return matches;
  }, [tree, searchQuery]);

  // A fresh query always starts back at its first match — otherwise a
  // leftover index from a previous search could silently point past the
  // end of a shorter new match list.
  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (searchMatches.length === 0) return;
    selectTreeNode(searchMatches[Math.min(searchIndex, searchMatches.length - 1)]);
  }, [searchMatches, searchIndex]);

  function goToSearchMatch(delta: number) {
    if (searchMatches.length === 0) return;
    setSearchIndex((i) => (i + delta + searchMatches.length) % searchMatches.length);
  }

  const bomSet = useMemo(
    () => (bomArticles ? new Set(bomArticles.map((a) => a.trim().toUpperCase()).filter(Boolean)) : null),
    [bomArticles],
  );
  const showTree = state === 'ready' && treeHasNames(tree);

  // Every currently-⚠️ node's best-guess article, counted — "однієї
  // позиції там може бути декілька штук" (2026-10-08 user report): the
  // same article often sits on several separate instance nodes (e.g. 4
  // identical bolts used across the assembly), and the BOM line added for
  // it needs qtyPerUnit equal to that count, not a flat 1. This is the
  // candidate set "Додати все" (add all) sends in one shot, and also what
  // a single row's own qty comes from (every row sharing an article shares
  // its count). Recomputes whenever the tree or the BOM cross-reference
  // changes, so it stays accurate after a partial add (some rows flip to
  // ✅ and drop out automatically).
  //
  // Restricted to nodes shaped like a real article — "ARTICLE-description"
  // (has a dash) or a bare numeric article using `_`/`.` as its own
  // separator (e.g. "434924_195", "440166_1") — see `isArticleCandidateName`
  // — deliberately NOT every ⚠️ node, unlike the per-row "+" button. A real
  // assembly's generic, auto-generated solid-body leaf name (e.g. "Твердое
  // тело1") also shows up as ⚠️ (the display cross-reference checks every
  // named node, on purpose — see the file header comment), and it alone can
  // repeat thousands of times in one file (confirmed: 17034 of 34257 nodes
  // in a real 440158.glb). Bulk-querying the catalog once per name for that
  // many bogus candidates would be slow and pointless — it's not a real
  // article. A human clicking one specific row's own "+" still works on any
  // name; this bulk action only fires on names that actually look like the
  // CAD export's own article convention.
  const unmatchedArticleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!bomSet) return counts;
    const set = bomSet;
    // "а пише 121" (2026-10-09) — same "qtyOverride is authoritative, stray
    // un-instanced leftovers for an already-locked article don't add
    // anything" reasoning as `analyzeGlbParts`'s own walk — see its
    // comment for the full why.
    const qtyLockedArticles = new Set<string>();
    function walk(nodes: ModelTreeNode[]) {
      for (const node of nodes) {
        if (node.name && isArticleCandidateName(node.name.trim()) && !articleMatches(node.name, set)) {
          const article = extractArticleCandidate(node.name);
          if (node.qtyOverride != null) {
            counts.set(article, node.qtyOverride);
            qtyLockedArticles.add(article);
          } else if (!qtyLockedArticles.has(article)) {
            counts.set(article, (counts.get(article) ?? 0) + 1);
          }
        }
        walk(node.children);
      }
    }
    walk(tree);
    return counts;
  }, [tree, bomSet]);

  async function addArticles(items: { article: string; qty: number }[]) {
    if (!onAddToBom || items.length === 0) return;
    setBulkError(null);
    setPendingArticles((prev) => new Set([...prev, ...items.map((i) => i.article)]));
    try {
      const { notFound } = await onAddToBom(items);
      setNotFoundArticles((prev) => new Set([...prev, ...notFound]));
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingArticles((prev) => {
        const next = new Set(prev);
        for (const i of items) next.delete(i.article);
        return next;
      });
    }
  }

  // "потрібно щоб воно робило фото саме цієї деталі і додавало" +
  // "щоб до товару додавало gbl файл саме цієї позиції" (2026-10-08):
  // grabs the node's own isolated snapshot AND its standalone .glb export
  // from the live scene (see `mountScene`'s `captureSnapshot` /
  // `exportPartGlb`) right before bubbling the create-product request up —
  // the tree row itself only knows the node id, not how to reach into the
  // 3D scene, so this wrapper is what's actually threaded down as the
  // `onCreateProduct` prop. The snapshot is synchronous (so it reads the
  // scene before the export's own async work could let anything else
  // touch it); the export is the only `await` here.
  async function handleCreateProductRequest(nodeId: string, article: string, suggestedName: string, qty: number) {
    const photoDataUrl = sceneApiRef.current?.captureSnapshot(nodeId) ?? null;
    const glb = (await sceneApiRef.current?.exportPartGlb(nodeId)) ?? null;
    const volumeMm3 = sceneApiRef.current?.computeVolume(nodeId) ?? null;
    onCreateProduct?.(article, suggestedName, qty, photoDataUrl, glb, volumeMm3);
  }

  // "а 3д модель усього виробу увімкнути камеру" (2026-10-10): with
  // nothing selected (or no `onActivateAr` wired at all — a caller that
  // never passed it still gets whole-model AR for free), AR shows the
  // WHOLE assembly straight from `arGlbUrl` (falling back to `glbUrl` —
  // see that prop's own header comment for why they can differ) — already
  // a real, presigned URL, no export/upload round trip needed at all. A
  // selected node, when `onActivateAr` IS wired, narrows AR down to just
  // that one part instead (same "don't pay the export cost up front"
  // reasoning as `ArViewButton` itself — this whole closure only runs once
  // the user actually taps the button).
  async function handleActivateArRequest(): Promise<string | null> {
    const wholeModelArUrl = arGlbUrl ?? glbUrl ?? null;
    if (!selectedId || !onActivateAr) return wholeModelArUrl;
    const node = findNodeById(tree, selectedId);
    if (!node?.name) return wholeModelArUrl;
    const article = extractArticleCandidate(node.name);
    const glb = (await sceneApiRef.current?.exportPartGlb(selectedId)) ?? null;
    return onActivateAr(article, node.name, glb);
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
        {state === 'ready' && selectedId && (
          <button
            type="button"
            onClick={() => setIsolateMode((v) => !v)}
            className={cn(
              'absolute left-2 top-2 flex items-center gap-1.5 rounded border border-border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm hover:bg-secondary/50',
              isolateMode && 'border-primary text-primary',
            )}
          >
            {isolateMode ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {isolateMode ? t('showAllParts') : t('isolatePart')}
          </button>
        )}
        {state === 'ready' && (
          <button
            type="button"
            onClick={() => setExplodedMode((v) => !v)}
            className={cn(
              'absolute left-2 flex items-center gap-1.5 rounded border border-border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm hover:bg-secondary/50',
              selectedId ? 'top-10' : 'top-2',
              explodedMode && 'border-primary text-primary',
            )}
          >
            {explodedMode ? <Shrink className="h-3 w-3" /> : <Expand className="h-3 w-3" />}
            {explodedMode ? t('assembleModel') : t('explodeModel')}
          </button>
        )}
        {state === 'ready' && glbUrl && (
          <ArViewButton getGlbUrl={handleActivateArRequest} className="absolute right-2 top-2 bg-background/90 shadow-sm" />
        )}
        {state === 'loading' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('loadingModel')}</p>
        )}
        {state === 'error' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{t('modelLoadError')}</p>
        )}
      </div>
      {showTree && (
        <div className="flex h-40 w-full shrink-0 flex-col overflow-y-auto border-t border-border p-2 sm:h-auto sm:w-64 sm:border-t-0 sm:border-l">
          <div className="sticky top-0 z-10 mb-2 shrink-0 bg-background pb-2">
            <div className="flex items-center gap-1 rounded border border-border px-1.5">
              <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    goToSearchMatch(e.shiftKey ? -1 : 1);
                  }
                }}
                placeholder={t('searchByCodePlaceholder')}
                className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <>
                  <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
                    {searchMatches.length > 0 ? `${searchIndex + 1}/${searchMatches.length}` : t('searchNoMatches')}
                  </span>
                  {searchMatches.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => goToSearchMatch(-1)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={t('searchPrevious')}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => goToSearchMatch(1)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={t('searchNext')}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('searchClear')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          </div>
          {onAddToBom && unmatchedArticleCounts.size > 0 && (
            <button
              type="button"
              onClick={() => addArticles(Array.from(unmatchedArticleCounts, ([article, qty]) => ({ article, qty })))}
              disabled={pendingArticles.size > 0}
              className="mb-2 flex shrink-0 items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-secondary/50 disabled:opacity-50"
            >
              {pendingArticles.size > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {t('addAllToBom', { count: unmatchedArticleCounts.size })}
            </button>
          )}
          {bulkError && <p className="mb-2 shrink-0 text-xs text-destructive">{bulkError}</p>}
          <ModelTreeList
            nodes={tree}
            selectedId={selectedId}
            onSelect={selectTreeNode}
            bomSet={bomSet}
            onAddToBom={onAddToBom ? addArticles : undefined}
            articleCounts={unmatchedArticleCounts}
            pendingArticles={pendingArticles}
            notFoundArticles={notFoundArticles}
            onCreateProduct={onCreateProduct ? handleCreateProductRequest : undefined}
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
  articleCounts,
  pendingArticles,
  notFoundArticles,
  onCreateProduct,
}: {
  nodes: ModelTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  bomSet: Set<string> | null;
  onAddToBom?: (items: { article: string; qty: number }[]) => void;
  articleCounts: Map<string, number>;
  pendingArticles: Set<string>;
  notFoundArticles: Set<string>;
  onCreateProduct?: (nodeId: string, article: string, suggestedName: string, qty: number) => void;
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
          articleCounts={articleCounts}
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
  articleCounts,
  pendingArticles,
  notFoundArticles,
  onCreateProduct,
}: {
  node: ModelTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  bomSet: Set<string> | null;
  onAddToBom?: (items: { article: string; qty: number }[]) => void;
  articleCounts: Map<string, number>;
  pendingArticles: Set<string>;
  notFoundArticles: Set<string>;
  onCreateProduct?: (nodeId: string, article: string, suggestedName: string, qty: number) => void;
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
  // "однієї позиції там може бути декілька штук" (2026-10-08): how many
  // separate instance nodes share this same article — falls back to 1 for
  // a node outside `articleCounts` (e.g. a dashless/generic name a human
  // explicitly "+"'d despite the bulk action skipping it — see
  // `unmatchedArticleCounts`'s own header comment), where no reliable
  // instance count exists.
  const qty = articleCounts.get(article) ?? 1;

  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    onAddToBom?.([{ article, qty }]);
  }

  function handleCreateProduct(e: React.MouseEvent) {
    e.stopPropagation();
    onCreateProduct?.(node.id, article, suggestProductName(node.name), qty);
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
            {qty > 1 && <span className="shrink-0 text-[10px] text-muted-foreground">×{qty}</span>}
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
            articleCounts={articleCounts}
            pendingArticles={pendingArticles}
            notFoundArticles={notFoundArticles}
            onCreateProduct={onCreateProduct}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Does this node name look like a real CAD-export article, as opposed to a
 * generic auto-named solid body or internal instance id? Two shapes seen in
 * practice: "ARTICLE-description" (a dash not at the very start), and a bare
 * numeric article that uses `_`/`.` as its OWN internal separator instead of
 * a dash — e.g. "434924_195", "440166_1", "264084.02" (real example,
 * 2026-10-08 user report: "434924_195_59" was visible in the interactive GLB
 * tree but missing from the Деталі (3D) tab, because this gate used to
 * require a literal dash). A name made of letters (e.g. "Твердое тело1", the
 * generic CAD-export placeholder repeated on every mesh leaf — confirmed via
 * a real file: 17034 of its 34257 nodes carry that exact name, none with
 * children) matches neither shape and is correctly excluded.
 */
function isArticleCandidateName(trimmed: string): boolean {
  if (trimmed.indexOf('-') > 0) return true;
  return /^\d+([._]\d+)*$/.test(trimmed);
}

/**
 * "та ж логіка така що якщо є _ то артикул до нього а підкреслення і все
 * що далі то не артикул" (2026-10-09, user-confirmed, explicitly overriding
 * the earlier narrower rule): whichever of `-`/`_` comes FIRST in the
 * string is the split point, full stop — no exception for a name shaped
 * like a bare numeric article. A name can have both separators (e.g.
 * "K00023-SK Schraube_M 8 x 20..."), where the dash right after the code
 * must still win over the later underscore inside the description.
 *
 * This is deliberately simpler than (and supersedes) an earlier version
 * that special-cased "434924_195"-shaped names to NOT split, reasoning
 * that the underscore was part of a stable, repeating identity there —
 * the user confirmed they want the blanket rule anyway, even knowing a
 * few products already created today under the old rule (article
 * "434924_195" itself, plus "434920_211"/"440167_421"/"275430.1666_415")
 * will no longer match their own already-stored article once this
 * extracts "434924" instead.
 */
function articleSplitIndex(trimmed: string): number {
  const dashIndex = trimmed.indexOf('-');
  const underscoreIndex = trimmed.indexOf('_');
  const candidates = [dashIndex, underscoreIndex].filter((i) => i > 0);
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

/** Best-guess article for the "➕ add to BOM" action — mirrors `articleMatches`' own fallback: prefer the prefix before the split point (`articleSplitIndex`) when present, else the full trimmed name. */
function extractArticleCandidate(name: string): string {
  const trimmed = name.trim();
  const splitIndex = articleSplitIndex(trimmed);
  return splitIndex > 0 ? trimmed.slice(0, splitIndex).trim() : trimmed;
}

/** Rough product-name guess for the "create product" prefill: everything after the article's split point (`articleSplitIndex`), with CAD-export underscores turned back into spaces — just a starting point the user edits in the create form, not meant to be exact. */
function suggestProductName(name: string): string {
  const trimmed = name.trim();
  const splitIndex = articleSplitIndex(trimmed);
  const rest = splitIndex > 0 ? trimmed.slice(splitIndex + 1) : trimmed;
  return rest.trim().replace(/_/g, ' ');
}

/** Depth-first lookup by id — the tree only ever gets walked top-down via `ModelTreeList`'s own recursion elsewhere; this is the one spot (`handleActivateArRequest`) that needs the selected node's own data outside that recursion. */
function findNodeById(nodes: ModelTreeNode[], id: string): ModelTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

function treeHasNames(nodes: ModelTreeNode[]): boolean {
  return nodes.some((n) => Boolean(n.name.trim()) || treeHasNames(n.children));
}

/**
 * A glTF node's name is rarely JUST the article — a real-world example
 * (2026-10-08 user report) is `"278807-Flachstahl_EST;_120_x_..."`:
 * article, then a bare `-` (no surrounding spaces), then the part's own
 * name; another (2026-10-09) is `"K00030_ISO 4017"`, same shape but split
 * on `_` instead. Tries the full trimmed name first (covers a node that
 * genuinely IS only the article), then falls back to everything before
 * `articleSplitIndex`'s split point.
 */
function articleMatches(name: string, bomSet: Set<string>): boolean {
  const trimmed = name.trim();
  if (bomSet.has(trimmed.toUpperCase())) return true;
  const splitIndex = articleSplitIndex(trimmed);
  if (splitIndex > 0) {
    const prefix = trimmed.slice(0, splitIndex).trim();
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
/**
 * GLTFLoader's own `_loadNodeShallow` (three/examples/jsm/loaders/GLTFLoader.js)
 * unconditionally does `node.userData.name = nodeDef.name; node.name =
 * parser.createUniqueName(nodeDef.name)` for every named node — `.name`
 * itself is NOT the raw glTF name, it's a scene-graph-unique one, with a
 * `_1`, `_2`, ... suffix appended per repeat of an already-seen name
 * (tracked globally across the whole file, in `GLTFParser.nodeNamesUsed`).
 * Real, confirmed-live impact (2026-10-08 user report: "2754301666_415_4
 * 2754301666_415_3 2754301666_415_2" visibly duplicated in Деталі (3D)): a
 * part physically reused N times in one assembly, with the SAME raw name
 * on every instance (e.g. "275430.1666_415" ×5 in a real file), got
 * fragmented into N differently-named tree nodes by the time any of this
 * file's own code ever saw `.name` — so `analyzeGlbParts`'s dedup-by-name
 * (and the interactive tree's own "Додати все"/qty count) created N
 * separate 1-off articles instead of recognizing one article used N
 * times. `userData.name` is the one place the original, non-mangled name
 * survives — prefer it here so every consumer of `ModelTreeNode.name`
 * (article matching, dedup, display) sees the real name, while distinct
 * `ModelTreeNode`s stay distinct via their own `id` (never `.name`
 * itself) regardless.
 */
function buildTree(group: THREE.Object3D): ModelTreeNode[] {
  function walk(object: THREE.Object3D): ModelTreeNode {
    const id = `tree-${treeNodeIdCounter++}`;
    object.userData.__treeNodeId = id;
    if (object instanceof THREE.Mesh) {
      object.material = Array.isArray(object.material) ? object.material.map((m) => m.clone()) : object.material.clone();
    }
    const originalName = typeof object.userData.name === 'string' ? object.userData.name : undefined;
    const qtyOverride = typeof object.userData.shQty === 'number' ? object.userData.shQty : undefined;
    return {
      id,
      name: originalName ?? object.name ?? '',
      isLeaf: object.children.length === 0,
      children: object.children.map(walk),
      qtyOverride,
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
function mountScene(
  container: HTMLDivElement,
  group: THREE.Object3D,
  onPick: (id: string | null, instanceId?: number) => void,
): SceneApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f4f6);
  scene.add(group);

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const volumeScaleToMm3 = volumeUnitScaleToMm3(maxDim);
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

  // "додай приближення саме до неї бо не завжди видно" (2026-10-08): a
  // selected part can be a tiny fraction of a large assembly's bounding
  // box, easy to miss at the model's own default overview framing. Eased
  // camera position/target interpolation, driven from the existing render
  // loop rather than a second rAF loop — `focusCameraOn` below just sets
  // the start/end state and a start time; `animate` advances it every
  // frame until `duration` elapses, then clears it so `controls.update()`
  // (user-drag orbiting) takes back over undisturbed.
  let flyAnimation: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;

  /**
   * "коли натискаєш на одну деталь воно виділяє всі однотипні деталі"
   * (2026-10-09): GPU-instancing (GlbOptimizationService) renders every
   * "extra" duplicate occurrence of a repeated part as ONE shared
   * `THREE.InstancedMesh` — one draw call standing in for all of them —
   * so a plain `Box3().setFromObject(target)` on that object returns the
   * bounds of the WHOLE group (every instance combined), not the single
   * one actually clicked. `instanceId` (present only for a raycast hit on
   * an `InstancedMesh`, via `onClick` below — a list-row selection has no
   * such thing, since a batched instance isn't individually listed at
   * all) lets this compute THAT instance's own world-space bounds
   * instead: its matrix (`getMatrixAt`) composed with the InstancedMesh's
   * own `matrixWorld`, applied to the shared geometry's local bounding
   * box. Highlighting still lights up the whole group (one shared
   * material, no per-instance color pass — a known, accepted gap for
   * now) — this only fixes where the camera flies to.
   */
  function focusCameraOn(target: THREE.Object3D, instanceId?: number) {
    let targetBox: THREE.Box3;
    if (target instanceof THREE.InstancedMesh && instanceId != null) {
      if (!target.geometry.boundingBox) target.geometry.computeBoundingBox();
      const instanceMatrix = new THREE.Matrix4();
      target.getMatrixAt(instanceId, instanceMatrix);
      const worldMatrix = target.matrixWorld.clone().multiply(instanceMatrix);
      targetBox = (target.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(worldMatrix);
    } else {
      targetBox = new THREE.Box3().setFromObject(target);
    }
    const targetSphere = targetBox.getBoundingSphere(new THREE.Sphere());
    if (targetSphere.radius <= 0) return;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const margin = 1.8; // looser than the snapshot's 1.1 — leaves nearby context visible, not just the bare part
    const distance = Math.max(
      (targetSphere.radius * margin) / Math.sin(vFov / 2),
      (targetSphere.radius * margin) / Math.sin(hFov / 2),
      camera.near * 2,
    );
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() === 0) dir.set(0.6, 0.5, 0.6);
    dir.normalize();
    flyAnimation = {
      fromPos: camera.position.clone(),
      toPos: targetSphere.center.clone().add(dir.multiplyScalar(distance)),
      fromTarget: controls.target.clone(),
      toTarget: targetSphere.center.clone(),
      start: performance.now(),
      duration: 450,
    };
  }

  // "просто подивитись анімацію" (2026-10-09): every direct child of
  // `group` (the CAD export's own top-level grouping — confirmed on both
  // real test files to be a sane, human-scale count: 125 and 310, not the
  // tens of thousands a full per-mesh explode would churn through) eases
  // outward along its OWN direction from the assembly's center (`group`
  // is already re-centered on that center a few lines up, at `group.
  // position.sub(center)`, so a child's own local `.position` IS already
  // that direction) and back. `explodeT` (0 = assembled, 1 = fully
  // exploded) is the single source of truth `setExploded` tweens toward —
  // computed once, lazily, on first use (no need to redo this if the
  // user toggles back and forth without reselecting anything).
  const EXPLODE_DISTANCE_FACTOR = 0.6;
  let explodeTargets: { object: THREE.Object3D; assembled: THREE.Vector3; exploded: THREE.Vector3 }[] | null = null;
  let explodeT = 0;
  let explodeAnimation: { from: number; to: number; start: number; duration: number } | null = null;

  function setExploded(enabled: boolean) {
    if (!explodeTargets) {
      explodeTargets = group.children.map((object) => {
        const assembled = object.position.clone();
        const dir = assembled.lengthSq() > 1e-9 ? assembled.clone().normalize() : new THREE.Vector3(0, 1, 0);
        return { object, assembled, exploded: assembled.clone().addScaledVector(dir, maxDim * EXPLODE_DISTANCE_FACTOR) };
      });
    }
    explodeAnimation = { from: explodeT, to: enabled ? 1 : 0, start: performance.now(), duration: 900 };
  }

  let animationFrame: number | undefined;
  function animate() {
    animationFrame = requestAnimationFrame(animate);
    if (flyAnimation) {
      const elapsed = (performance.now() - flyAnimation.start) / flyAnimation.duration;
      const t = Math.min(1, elapsed);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      camera.position.lerpVectors(flyAnimation.fromPos, flyAnimation.toPos, eased);
      controls.target.lerpVectors(flyAnimation.fromTarget, flyAnimation.toTarget, eased);
      if (t >= 1) flyAnimation = null;
    }
    if (explodeAnimation) {
      const elapsed = (performance.now() - explodeAnimation.start) / explodeAnimation.duration;
      const t = Math.min(1, elapsed);
      const eased = 1 - (1 - t) ** 3;
      explodeT = explodeAnimation.from + (explodeAnimation.to - explodeAnimation.from) * eased;
      if (explodeTargets) {
        for (const target of explodeTargets) target.object.position.lerpVectors(target.assembled, target.exploded, explodeT);
      }
      if (t >= 1) explodeAnimation = null;
    }
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
  let isolated = false;
  let currentTarget: THREE.Object3D | null = null;

  /** `target === null` means "nothing to isolate" — shows every mesh regardless of `isolated`'s own flag, since isolating down to nothing would just be a blank viewport. */
  function applyIsolation(target: THREE.Object3D | null) {
    const visible = target ? new Set(meshesUnder(target)) : null;
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.visible = visible ? visible.has(o) : true;
    });
  }

  function setSelected(id: string | null, instanceId?: number) {
    highlighted.forEach(clearHighlight);
    highlighted = [];
    currentTarget = id ? findByTreeId(group, id) : null;
    if (!currentTarget) {
      if (isolated) applyIsolation(null);
      return;
    }
    highlighted = meshesUnder(currentTarget);
    highlighted.forEach(applyHighlight);
    focusCameraOn(currentTarget, instanceId);
    if (isolated) applyIsolation(currentTarget);
  }

  function setIsolated(enabled: boolean) {
    isolated = enabled;
    applyIsolation(enabled ? currentTarget : null);
  }

  function onClick(e: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(group, true);
    const hit = hits[0];
    onPick(hit ? ((hit.object.userData.__treeNodeId as string | undefined) ?? null) : null, hit?.instanceId);
  }
  renderer.domElement.addEventListener('click', onClick);

  // "потрібно щоб воно робило фото саме цієї деталі" (2026-10-08): a
  // "create product" prefill photo — isolates `id`'s own mesh(es) (every
  // other mesh in the model hidden), frames the camera tight on just its
  // bounding box (see the shared `isolateRenderToDataUrl`), renders ONE
  // frame into the existing (already-mounted, already-sized) renderer,
  // and reads it back as a PNG data URL. Runs fully synchronously —
  // visibility/camera mutation, render, `toDataURL` readback, and restore
  // all happen in one JS turn with no `await` between them — so the
  // browser never gets a chance to paint the isolated/zoomed intermediate
  // frame; the visible canvas only ever shows the normal view before and
  // after. `toDataURL` reads the backbuffer immediately after `render()`,
  // before the NEXT `render()` (the restore call) touches it — the
  // standard three.js screenshot pattern, and why this doesn't need
  // `preserveDrawingBuffer: true` on the renderer (which would cost the
  // main animation loop a copy every frame for a feature used maybe once
  // per session).
  function captureSnapshot(id: string): string | null {
    const target = findByTreeId(group, id);
    if (!target || meshesUnder(target).length === 0) return null;

    const savedCameraPosition = camera.position.clone();
    const savedTarget = controls.target.clone();

    const dataUrl = isolateRenderToDataUrl(renderer, scene, camera, group, target);

    camera.position.copy(savedCameraPosition);
    controls.target.copy(savedTarget);
    camera.lookAt(controls.target);
    renderer.render(scene, camera);

    return dataUrl;
  }

  // "до товару додавало glb файл саме цієї позиції якої робить фото"
  // (2026-10-08): companion to `captureSnapshot` — exports just the
  // target node's own subtree (its meshes, with the same per-node-cloned
  // materials `buildTree` already set up) as a standalone, binary .glb,
  // via three.js's own `GLTFExporter`. Unlike `captureSnapshot`, this
  // never touches the live scene's visibility/camera at all — passing
  // `target` alone (not `group`) to `parseAsync` already scopes the
  // export to just that subtree, regardless of what else in the model is
  // currently visible. The part's own LOCAL transform (relative to its
  // parent in the full assembly) carries over as-is into the exported
  // file's root — irrelevant once it's loaded standalone, since
  // Step3DViewer's own `mountScene` re-centers whatever it loads on its
  // own bounding box anyway.
  async function exportPartGlb(id: string): Promise<ArrayBuffer | null> {
    const target = findByTreeId(group, id);
    if (!target || meshesUnder(target).length === 0) return null;
    const result = await new GLTFExporter().parseAsync(target, { binary: true });
    return result instanceof ArrayBuffer ? result : null;
  }

  function computeVolume(id: string): number | null {
    const target = findByTreeId(group, id);
    if (!target || meshesUnder(target).length === 0) return null;
    return computeMeshVolume(target, volumeScaleToMm3);
  }

  return {
    setSelected,
    setIsolated,
    setExploded,
    captureSnapshot,
    exportPartGlb,
    computeVolume,
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

function meshesUnder(object: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  object.traverse((o) => { if (o instanceof THREE.Mesh) found.push(o); });
  return found;
}

/**
 * Not every GLB this app loads uses the same linear unit, even though the
 * returned volume always needs to end up in mm³. The server's own
 * STEP→GLB pipeline (`step-convert-child.js`) never rescales — those
 * files stay in the STEP file's native millimeters, with a whole
 * multi-part assembly's bounding box typically in the hundreds-to-low-
 * thousands. A directly user-uploaded `.glb` (bypassing that pipeline
 * entirely) can instead follow glTF's own spec-mandated "canonical
 * meters" convention — confirmed live on a real file: its mesh nodes
 * carried an explicit `0.01` local scale (cm→m) layered under a parent
 * chain whose own translations were already meter-scale (e.g. `0.0248`
 * for a ~24.8mm offset) — so a correctly `matrixWorld`-composed point is
 * already in meters there, and treating it as mm (dividing by 1e9 a
 * second time downstream) silently rounds any real part's weight to
 * "0.000 кг" (a real, reported bug: "пише 0 кг" for a confirmed-solid
 * bracket).
 *
 * Resolved per FILE, not per part: a single small part's own size is
 * genuinely ambiguous (a bare "5" could be 5mm or 5m, both plausible for
 * *something*), but a whole ASSEMBLY's composed bounding box is not — no
 * mechanical assembly this app handles is realistically 50+ meters
 * across, so a group-level `maxDim` that big can only mean the file's
 * units are still raw millimeters; anything smaller is (already
 * correctly scaled) meters. Call this once per model load (`group`'s own
 * bounding box, already computed for camera framing) and reuse the
 * result for every part's volume in that file.
 */
function linearUnitScaleToMm(groupMaxDim: number): number {
  const ALREADY_METERS_MAX_DIM = 50;
  return groupMaxDim < ALREADY_METERS_MAX_DIM ? 1000 : 1;
}

/** Volume scales as the CUBE of the linear unit factor above — same per-file unit decision, just raised to the power that matches what's being converted (mm vs mm³ vs, below, mm²). */
function volumeUnitScaleToMm3(groupMaxDim: number): number {
  return linearUnitScaleToMm(groupMaxDim) ** 3;
}

/**
 * Sum of signed tetrahedron volumes (divergence theorem) over every
 * triangle of every mesh under `object`, in world space — the
 * mathematically EXACT volume for a proper single-sided closed mesh.
 * Returns the raw signed value (not `Math.abs`'d) so the caller can
 * compare its magnitude against a convex-hull volume to detect the
 * face-duplication trap described on `computeMeshVolume`.
 */
function signedMeshVolume(meshes: THREE.Mesh[]): number {
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const triCount = index ? index.count / 3 : position.count / 3;
    for (let i = 0; i < triCount; i++) {
      const ia = index ? index.getX(i * 3) : i * 3;
      const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
      volume += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return volume;
}

function convexHullVolume(points: THREE.Vector3[]): number {
  let hull: THREE.BufferGeometry;
  try {
    hull = new ConvexGeometry(points);
  } catch {
    return 0; // degenerate point set (e.g. coplanar) — no well-defined hull
  }
  const hullPosition = hull.attributes.position; // ConvexGeometry emits a non-indexed, already-triangulated, consistently-wound BufferGeometry
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < hullPosition.count / 3; i++) {
    a.fromBufferAttribute(hullPosition, i * 3);
    b.fromBufferAttribute(hullPosition, i * 3 + 1);
    c.fromBufferAttribute(hullPosition, i * 3 + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(volume);
}

/**
 * "там би воно рахувало вагу залежно від обєму і матеріалу" (2026-10-08):
 * an estimate of `object`'s own solid volume (and every descendant's), in
 * mm³ (`unitScaleToMm3` — see `volumeUnitScaleToMm3` above — converts from
 * whatever linear unit this particular file's `matrixWorld`-composed
 * coordinates actually turned out to be in). The caller
 * (`CreateProductDialog`'s material/weight helper) divides by 1e9 to get
 * m³ before multiplying by a density in kg/m³.
 *
 * Prefers the EXACT `signedMeshVolume` (the raw triangle mesh, via the
 * divergence theorem) and only falls back to the convex hull when that
 * comes back suspiciously near zero. Real, confirmed-live history behind
 * this: the signed-tetrahedron sum was tried first, came back ≈0 for a
 * bearing, and got replaced outright with the convex hull (CAD-export
 * tessellation is not reliably a single consistently-wound closed shell —
 * many exporters duplicate every face with the opposite winding for
 * backface-safe rendering, and two perfectly opposite-signed copies of
 * every triangle cancel to exactly zero when summed directly, which a
 * hull's own consistently-wound, non-duplicated faces can't fall into).
 * But the hull is an OVERESTIMATE for any non-convex part, and for a part
 * whose cross-section varies sharply along its length (2026-10-08 user
 * report: "434924_195" is a ~2.2m rail with thick mounting ends and a
 * thin web between them) that overestimate is severe — the hull fills in
 * the whole tapered gap as solid material along the full length. Measured
 * on that exact part: hull → "136.554 кг", exact signed volume →
 * "11.78 кг" (a real mechanical dimension spec confirms the thin-web rail
 * reading is the right order of magnitude). So: trust the exact value
 * whenever it's not the near-zero cancellation artifact (its magnitude is
 * at least 1% of the hull's — real cancellation residue is floating-point
 * noise, orders of magnitude smaller than that), and only fall back to
 * the hull's known-overestimate for the genuine duplicated-face case.
 */
function computeMeshVolume(object: THREE.Object3D, unitScaleToMm3: number): number {
  const meshes = meshesUnder(object);
  const points: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    }
  }
  if (points.length < 4) return 0;

  const hullVolume = convexHullVolume(points);
  const exactVolume = Math.abs(signedMeshVolume(meshes));
  const volume = exactVolume > hullVolume * 0.01 ? exactVolume : hullVolume;
  return volume * unitScaleToMm3;
}

/**
 * "габаритні розміри... довжина ширина висота" (2026-10-09): a plain
 * world-space axis-aligned bounding box of the part's own vertices, in
 * mm. Simpler than (and consistent with) the volume/camera-framing math
 * above, with the same known trade-off those already accept — a part
 * installed at an angle gets measured along the WORLD's X/Y/Z axes, not
 * its own natural ones, so a diagonally-mounted part can read larger
 * than its real envelope. Treated the same as weight/volume throughout
 * this app: a quick estimate the user reviews, not a certified
 * measurement.
 */
function computeMeshDimensionsMm(object: THREE.Object3D, linearScaleToMm: number): { x: number; y: number; z: number } | null {
  const points: THREE.Vector3[] = [];
  for (const mesh of meshesUnder(object)) {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    }
  }
  if (points.length === 0) return null;
  const size = new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3());
  return { x: size.x * linearScaleToMm, y: size.y * linearScaleToMm, z: size.z * linearScaleToMm };
}

/**
 * "площа поверхні... для автоматичного прорахунку витрат фарби чи лаку"
 * (2026-10-09): exact sum of triangle areas (not an approximation like
 * the hull fallback `computeMeshVolume` sometimes needs) — area, unlike
 * signed volume, can't use cancellation to detect the duplicated-
 * opposite-winding-face trap those other functions work around, so this
 * instead skips any triangle whose 3 world-space vertices (rounded to
 * 4 decimals) were already counted once under a DIFFERENT winding order
 * — the exact shape of that trap (two perfectly coincident copies of
 * the same triangle, wound oppositely for backface-safe rendering).
 */
function computeMeshSurfaceAreaMm2(object: THREE.Object3D, areaScaleToMm2: number): number {
  const seen = new Set<string>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const keyOf = (v: THREE.Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  let area = 0;
  for (const mesh of meshesUnder(object)) {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const triCount = index ? index.count / 3 : position.count / 3;
    for (let i = 0; i < triCount; i++) {
      const ia = index ? index.getX(i * 3) : i * 3;
      const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
      const triKey = [keyOf(a), keyOf(b), keyOf(c)].sort().join('|');
      if (seen.has(triKey)) continue;
      seen.add(triKey);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      area += cross.length() / 2;
    }
  }
  return area * areaScaleToMm2;
}

/**
 * Shared by `captureSnapshot` (interactive viewer) and `analyzeGlbParts`
 * (headless, "Деталі (3D)" tab — see below): hides every mesh except
 * `target`'s own, frames `camera` tight on `target`'s bounding sphere
 * (fit against both the vertical AND the derived horizontal FOV, with a
 * small 10% margin — see the "можна якось її більше зробити" header note
 * on why a bounding-sphere+FOV fit replaced the old fixed-offset framing),
 * renders one frame, reads it back as a PNG data URL, then restores every
 * mesh's visibility/emissive. Deliberately does NOT restore the camera's
 * own position — `captureSnapshot` does that itself (it has a "normal
 * view" to return to); the headless caller doesn't need to, since it
 * repositions the camera fresh for every part anyway.
 */
function isolateRenderToDataUrl(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  group: THREE.Object3D,
  target: THREE.Object3D,
): string {
  const targetSet = new Set(meshesUnder(target));

  const savedVisibility: [THREE.Mesh, boolean][] = [];
  const savedEmissive: [THREE.MeshStandardMaterial, THREE.Color][] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    savedVisibility.push([o, o.visible]);
    o.visible = targetSet.has(o);
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of materials) {
      if ('emissive' in mat) {
        const m = mat as THREE.MeshStandardMaterial;
        savedEmissive.push([m, m.emissive.clone()]);
        m.emissive.set(0x000000);
      }
    }
  });

  const targetBox = new THREE.Box3().setFromObject(target);
  const targetSphere = targetBox.getBoundingSphere(new THREE.Sphere());
  const targetCenter = targetSphere.center;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const margin = 1.1;
  const distance = Math.max(
    (targetSphere.radius * margin) / Math.sin(vFov / 2),
    (targetSphere.radius * margin) / Math.sin(hFov / 2),
    camera.near * 2, // guards a tiny part in a huge assembly from landing inside the near plane
  );
  camera.position.copy(targetCenter).add(new THREE.Vector3(0.6, 0.5, 0.6).normalize().multiplyScalar(distance));
  camera.lookAt(targetCenter);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  savedVisibility.forEach(([mesh, visible]) => { mesh.visible = visible; });
  savedEmissive.forEach(([mat, emissive]) => { mat.emissive.copy(emissive); });

  return dataUrl;
}

export interface GlbPartAnalysis {
  nodeId: string;
  article: string;
  name: string;
  qty: number;
  photoDataUrl: string | null;
  /** This one instance's own solid volume in mm³ (see `computeMeshVolume`) — for the material/weight picker in the create-product flow. `null` only if the node somehow has no mesh geometry. */
  volumeMm3: number | null;
  /** World-space axis-aligned bounding box in mm (see `computeMeshDimensionsMm`'s own header comment on the "world axes, not the part's own" trade-off). `null` only if the node somehow has no mesh geometry. */
  dimensionsMm: { x: number; y: number; z: number } | null;
  /** Exact mesh surface area in mm² (see `computeMeshSurfaceAreaMm2`) — e.g. for estimating paint/coating per part. */
  surfaceAreaMm2: number;
  /**
   * "деталі які складаються з одної а є деталі які складаються з
   * декількох... ті які складаються з декількох то це підвиріб"
   * (2026-10-09): how many distinct meshes sit under this candidate's own
   * subtree. A real example from a live file: a node named like a plain
   * article ("437908_46") turned out to have 184 CHILDREN of its own —
   * not one screw, but a CAD-export selection-group bundling dozens of
   * unrelated fasteners under one (largely accidental) name. `1` is the
   * overwhelming common case (a real single part); the caller uses
   * `> 1` to split these into their own "Складові вузли" section instead
   * of offering "Створити товар" on something that isn't a simple part.
   */
  meshCount: number;
}

/**
 * "до існуючих товарів де є файл glb додай можливість рахувати вагу"
 * (2026-10-08): headless, whole-file counterpart to `analyzeGlbParts`'s
 * per-part `computeVolume` — for a product that already has its OWN
 * standalone .glb attached (not a sub-part inside some assembly's
 * model), the entire loaded scene already IS that one part, so there's
 * no tree-walking or per-article dedup to do, just the same volume math
 * (see `computeMeshVolume`) applied to the whole loaded group. Returns
 * `null` for an empty/degenerate model instead of `0`, so a caller can
 * tell "no usable geometry" apart from "a genuinely weightless sliver".
 */
export async function computeGlbVolume(glbUrl: string): Promise<number | null> {
  const group = await loadGlb(glbUrl);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const volume = computeMeshVolume(group, volumeUnitScaleToMm3(maxDim));
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose();
    }
  });
  return volume > 0 ? volume : null;
}

/**
 * "зроби можливість оновити фото в каталозі існуючих товарів якщо фото
 * витягнуло з gbl" (2026-10-08): whole-file counterpart to
 * `isolateRenderToDataUrl` (used per-part by `analyzeGlbParts`) — for a
 * product's own standalone .glb, the entire loaded scene already IS that
 * one part, so there's nothing to isolate (`target` = `group` itself,
 * same object twice). A one-off offscreen render, same camera-framing math
 * as every other snapshot in this file, torn down immediately after.
 */
export async function captureGlbSnapshot(glbUrl: string): Promise<string | null> {
  const group = await loadGlb(glbUrl);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  if (meshesUnder(group).length === 0) return null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f4f6);
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(maxDim, maxDim, maxDim);
  scene.add(dirLight);

  const SNAPSHOT_SIZE = 480;
  const camera = new THREE.PerspectiveCamera(45, 1, maxDim / 1000, maxDim * 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(SNAPSHOT_SIZE, SNAPSHOT_SIZE);

  const dataUrl = isolateRenderToDataUrl(renderer, scene, camera, group, group);

  renderer.dispose();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose();
    }
  });

  return dataUrl;
}

export interface GlbModelAnalysis {
  parts: GlbPartAnalysis[];
  /**
   * "коли тут створюєш товар то не додається до нього файл gbl"
   * (2026-10-08): a part's own standalone .glb is only worth exporting
   * for the ones the user actually turns into a product — exporting it
   * for every part up front (most of which are already in the catalog
   * and never touch this) would be wasted work. Reuses the SAME loaded
   * `group` this analysis already parsed — no second fetch/parse per
   * part. Returns `null` after `dispose()`, or if the node has no
   * geometry (shouldn't happen for a `nodeId` taken from `parts` itself).
   */
  exportPartGlb: (nodeId: string) => Promise<ArrayBuffer | null>;
  /** Releases the renderer + every mesh's geometry/material — call once `exportPartGlb` is no longer needed (component unmount, or before re-analyzing a different `glbUrl`). */
  dispose: () => void;
}

/**
 * "потрібно в специфікації щоб кожен раз не відкривати glb файл а була
 * вкладка аналізувати де весь склад прописаний" (2026-10-08): headless
 * counterpart to the interactive tree in `Step3DViewer` — loads a .glb,
 * walks its node tree, and returns one entry per distinct article (same
 * `isArticleCandidateName` restriction as the interactive tree's own
 * "Додати все" candidate set — see `unmatchedArticleCounts`'s header
 * comment for why: a real model's generic auto-named solid-body leaf can
 * otherwise repeat thousands of times and would flood the list)
 * with a rendered isolated-part snapshot for each — no visible 3D canvas,
 * no interactivity, just the data a flat parts-check table needs. Used by
 * `assembly-parts-check.tsx` so the user doesn't have to open the GLB
 * viewer dialog at all to see what's in the model.
 *
 * Matching against the assembly's current BOM, and catalog-existence
 * lookups, are deliberately NOT done here — this only answers "what parts
 * does the model contain", kept separate from "which of those are already
 * in this BOM / already in the catalog", which belong to the caller.
 *
 * The loaded `group` is deliberately NOT disposed when this returns (only
 * the rendering is done at that point, not every possible use of the
 * parsed model) — kept alive, captured in the returned `exportPartGlb`
 * closure, until the caller calls `dispose()` itself.
 */
export async function analyzeGlbParts(glbUrl: string): Promise<GlbModelAnalysis> {
  const group = await loadGlb(glbUrl);
  const tree = buildTree(group);

  const byArticle = new Map<string, { nodeId: string; article: string; name: string; qty: number }>();
  // "а пише 121" (2026-10-09, real report): `instance()` occasionally
  // leaves ONE extra node un-batched for a group it otherwise correctly
  // collapsed (confirmed on a real file — not every node sharing a mesh
  // with the protected representative actually gets swept into the
  // batch; gltf-transform's own instancing heuristics have edge cases
  // this app doesn't need to fully understand to work around). Once a
  // `qtyOverride`-bearing node is seen for an article, its value is
  // AUTHORITATIVE — every other node matching that same article (stray
  // leftovers like the one above) is a counting artifact, not a real
  // extra instance, and is ignored rather than added on top.
  const qtyLockedArticles = new Set<string>();
  function walk(nodes: ModelTreeNode[]) {
    for (const node of nodes) {
      if (node.name && isArticleCandidateName(node.name.trim())) {
        const article = extractArticleCandidate(node.name);
        if (node.qtyOverride != null) {
          byArticle.set(article, { nodeId: node.id, article, name: node.name, qty: node.qtyOverride });
          qtyLockedArticles.add(article);
        } else if (!qtyLockedArticles.has(article)) {
          const existing = byArticle.get(article);
          if (existing) existing.qty += 1;
          else byArticle.set(article, { nodeId: node.id, article, name: node.name, qty: 1 });
        }
      }
      walk(node.children);
    }
  }
  walk(tree);

  const partsMeta = Array.from(byArticle.values());
  if (partsMeta.length === 0) {
    return { parts: [], exportPartGlb: async () => null, dispose: () => {} };
  }

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const volumeScaleToMm3 = volumeUnitScaleToMm3(maxDim);
  const linearScaleToMm = linearUnitScaleToMm(maxDim);
  const areaScaleToMm2 = linearScaleToMm ** 2;
  group.position.sub(center);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f4f6);
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(maxDim, maxDim, maxDim);
  scene.add(dirLight);

  const SNAPSHOT_SIZE = 360;
  const camera = new THREE.PerspectiveCamera(45, 1, maxDim / 1000, maxDim * 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(SNAPSHOT_SIZE, SNAPSHOT_SIZE); // never appended to the DOM — a WebGLRenderer renders and reads back (toDataURL) just fine fully offscreen.

  const parts: GlbPartAnalysis[] = partsMeta
    .map((part) => {
      const target = findByTreeId(group, part.nodeId);
      const photoDataUrl = target ? isolateRenderToDataUrl(renderer, scene, camera, group, target) : null;
      const volumeMm3 = target ? computeMeshVolume(target, volumeScaleToMm3) : null;
      const meshCount = target ? meshesUnder(target).length : 0;
      const dimensionsMm = target ? computeMeshDimensionsMm(target, linearScaleToMm) : null;
      const surfaceAreaMm2 = target ? computeMeshSurfaceAreaMm2(target, areaScaleToMm2) : 0;
      return { nodeId: part.nodeId, article: part.article, name: part.name, qty: part.qty, photoDataUrl, volumeMm3, meshCount, dimensionsMm, surfaceAreaMm2 };
    })
    .sort((a, b) => a.article.localeCompare(b.article));

  let disposed = false;
  async function exportPartGlb(nodeId: string): Promise<ArrayBuffer | null> {
    if (disposed) return null;
    const target = findByTreeId(group, nodeId);
    if (!target || meshesUnder(target).length === 0) return null;
    const result = await new GLTFExporter().parseAsync(target, { binary: true });
    return result instanceof ArrayBuffer ? result : null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.dispose();
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose();
      }
    });
  }

  return { parts, exportPartGlb, dispose };
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
