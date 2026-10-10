#!/usr/bin/env node
// Runs the actual GPU-instancing pass in a fully separate OS process — same
// "kill the whole process from the outside, instant full memory reclaim"
// reasoning as step-convert-child.js's own header comment. Plain CommonJS,
// no ts-node/build step, spawned directly via `node glb-optimize-child.js`.
//
// "ціль щоб з телефона також відкривалось" (2026-10-09): a directly-
// uploaded .glb from a CAD export can have tens of thousands of
// scene-graph nodes despite a modest byte size — a real file came in at
// 10MB/34,257 nodes/only 54 unique meshes, and mobile Safari/WebKit
// crashed building that many THREE.Object3D instances (confirmed: the
// crash point was right as GLTFLoader finished building the scene graph,
// not during download). `@gltf-transform/functions`' `dedup()`+`instance()`
// collapses repeated-mesh nodes into `EXT_mesh_gpu_instancing` — one
// `THREE.InstancedMesh` per group instead of N separate nodes — which
// three.js's GLTFLoader already supports natively (no client-side change
// needed). Real-world expectation for a file shaped like the one above:
// 34,257 nodes down to the low hundreds.
//
// The catch (confirmed by reading gltf-transform's own `instance()`
// source): it does NOT preserve node names, not even for one
// "representative" instance — every node sharing a batched mesh gets its
// mesh cleared and is then pruned away entirely. This app identifies a
// CAD part by its node NAME (see `isArticleCandidateName`/
// `extractArticleCandidate`, ported below from step-3d-viewer.tsx) for
// "Деталі (3D)" and the interactive tree's article matching — losing
// every name would break both. The fix: AFTER `dedup()` (which links
// identical meshes so `instance()` can find them) but BEFORE `instance()`,
// clone() the mesh on every mesh-bearing node reachable from the first
// node seen per distinct article name. A cloned mesh is a distinct object
// reference even though its content is identical, so `instance()`'s own
// per-mesh reference count for that mesh drops to 1 (below `min`) and it
// leaves that node — and by extension its named parent, since pruning
// only removes nodes left with no mesh/children — completely untouched.
// Every OTHER occurrence of the same part (duplicate instances beyond the
// first, and every generically-named "Твердое тело1"-style leaf) still
// shares the original mesh reference and gets instanced away normally.
//
// "додатково спростити геометрію для файлів більше 70 мб і тільки якщо
// переглядати на телефоні" (2026-10-09): confirmed on a real, much bigger
// (106MB/63,377-node/1,718-unique-mesh) assembly that instancing alone
// isn't enough — most of its nodes are genuinely distinct parts, not
// repeated fasteners, so dedup+instance (default `min: 5`) only reduced
// it to 35,587 objects (44%, vs. 98% on the smaller repetitive file),
// still too many for mobile and still crashed. A SEPARATE "mobile"
// variant lowers `instance()`'s own `min` to 2 (a real test on the same
// file: 35,586 -> 1,949 nodes, 94.5%) AND additionally runs `weld()`+
// `simplify()` (meshoptimizer) AFTER instancing (order matters — see
// `buildOptimizedDoc`'s own dedup()/instance() call site for why doing it
// before breaks instancing's content-equality matching) for real mesh
// decimation on top, independent of and complementary to the node-count
// reduction. Desktop keeps full detail (the "optimized" output below is
// unaffected); only the extra mobile output, when requested via a 3rd CLI
// arg, pays this lossy cost. Built from a FRESH read of the input bytes
// each time (gltf-transform's `Document` has no built-in deep-clone) so
// the outputs never share mutated state.
//
// "показується не весь виріб а по одній деталі" (2026-10-10, real user
// report + confirmed root cause): `EXT_mesh_gpu_instancing` above is read
// correctly by three.js's own `GLTFLoader` (our interactive viewer) but
// NOT by `@google/model-viewer`'s bundled `USDZExporter` — confirmed by
// reading its source: it treats an `InstancedMesh` as a plain single
// `Mesh` (both share `isMesh === true`) and exports only ONE copy at the
// instance root's own transform. iOS AR Quick Look (which converts
// through USDZ) ends up missing every duplicate instance; Android Scene
// Viewer (raw .glb, no USDZ step) is unaffected. A THIRD variant — `'ar'`
// mode below, requested via a 4th CLI arg — runs `dedup()` only and skips
// `instance()` entirely, so every duplicate stays a real, separate glTF
// node (plus the same lossy weld+simplify decimation `'mobile'` mode
// uses, since node count can no longer be collapsed for this one).

const fs = require('fs');

const [, , inputGlbPath, outputGlbPath, mobileOutputGlbPath, arOutputGlbPath] = process.argv;
if (!inputGlbPath || !outputGlbPath) {
  console.error('Usage: node glb-optimize-child.js <input.glb> <output.glb> [mobile-output.glb] [ar-output.glb]');
  process.exit(2);
}

/** Ported verbatim from step-3d-viewer.tsx's own function of the same name — see that file for the full "why" history. A name made of letters-only (the generic CAD-export leaf placeholder) matches neither shape and is correctly excluded. */
function isArticleCandidateName(trimmed) {
  if (trimmed.indexOf('-') > 0) return true;
  return /^\d+([._]\d+)*$/.test(trimmed);
}

/** Ported verbatim from step-3d-viewer.tsx's own function of the same name. */
function articleSplitIndex(trimmed) {
  const dashIndex = trimmed.indexOf('-');
  const underscoreIndex = trimmed.indexOf('_');
  const candidates = [dashIndex, underscoreIndex].filter((i) => i > 0);
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

/** Ported verbatim from step-3d-viewer.tsx's own function of the same name. */
function extractArticleCandidate(name) {
  const trimmed = name.trim();
  const splitIndex = articleSplitIndex(trimmed);
  return splitIndex > 0 ? trimmed.slice(0, splitIndex).trim() : trimmed;
}

/** Every mesh-bearing node in `node`'s own subtree, `node` itself included — mirrors step-3d-viewer.tsx's `meshesUnder`, just over gltf-transform `Node`s instead of `THREE.Object3D`s. Desktop protection uses every result; mobile uses only the first (see `buildOptimizedDoc`'s own comment on why). */
function meshBearingNodesUnder(node, out) {
  if (node.getMesh()) out.push(node);
  for (const child of node.listChildren()) meshBearingNodesUnder(child, out);
  return out;
}

/**
 * Reads a FRESH `Document` from `inputBytes` and runs the shared
 * "protect named article representatives, then dedup(+instance)" pipeline
 * — see the file header for the full reasoning. `mode` is one of:
 * - `'desktop'`: full-subtree protection (needed for `exportPartGlb`),
 *   `instance()` at its conservative default `min`, no decimation.
 * - `'mobile'`: first-mesh-only protection, `instance({min: 2})`, plus
 *   lossy weld+simplify decimation AFTER instancing (order doesn't
 *   actually matter for dedup/instance's own correctness — simplifying
 *   first still let identical meshes dedup fine in testing — but doing it
 *   after means each already-deduplicated unique mesh gets decimated
 *   once, not once per original duplicate, which is strictly cheaper).
 * - `'ar'`: `dedup()` only, `instance()` SKIPPED ENTIRELY (see this
 *   file's header comment on `EXT_mesh_gpu_instancing` vs. model-viewer's
 *   `USDZExporter` for why), plus the same weld+simplify decimation as
 *   mobile to keep file size/triangle count in check now that node count
 *   can no longer be collapsed the way instancing does.
 */
async function buildOptimizedDoc(io, inputBytes, mode, label) {
  const doc = await io.readBinary(new Uint8Array(inputBytes));

  const allNodes = doc.getRoot().listNodes();
  const nodeCountBefore = allNodes.length;

  const seenArticles = new Set();
  const representativeNodes = [];
  const articleCounts = new Map();
  for (const node of allNodes) {
    const name = (node.getName() || '').trim();
    if (!name || !isArticleCandidateName(name)) continue;
    const article = extractArticleCandidate(name);
    articleCounts.set(article, (articleCounts.get(article) ?? 0) + 1);
    if (seenArticles.has(article)) continue;
    seenArticles.add(article);
    representativeNodes.push(node);
  }

  // "відображає неправильно потрібну кількість товарів" (2026-10-09):
  // instancing below collapses every OTHER occurrence of a repeated part
  // into an anonymous, unnamed batch — so by the time the client walks
  // the resulting tree counting same-named nodes (the ONLY way it had to
  // recover "how many of this part"), only this one representative is
  // left and the count always comes out to 1. Stamping the real original
  // count into this node's own glTF `extras` survives instancing (it's
  // never touched after this), and three.js's GLTFLoader merges `extras`
  // straight into `object.userData` — see `ModelTreeNode.qtyOverride`
  // (step-3d-viewer.tsx) for the client-side read.
  for (const node of representativeNodes) {
    const article = extractArticleCandidate((node.getName() || '').trim());
    node.setExtras({ ...node.getExtras(), shQty: articleCounts.get(article) ?? 1 });
  }

  const { dedup, instance } = require('@gltf-transform/functions');
  await doc.transform(dedup());

  let protectedMeshNodes = [];
  if (mode !== 'ar') {
    // "майже завантажилось але сторінка перегрузилась" (2026-10-09): the
    // FULL-subtree protection below (every mesh-bearing descendant of every
    // representative, not just one) is what `exportPartGlb` needs to
    // re-export a multi-piece part's complete geometry later — correct, but
    // expensive: a real test on this same file protected 22,762 mesh nodes
    // across just 1,008 representatives (~22.6 each — some "parts" are
    // really whole sub-assemblies), which alone blocked instance() from
    // reducing past 34,051 nodes even with `min: 2`. For the MOBILE
    // variant specifically — viewing-only, not a source for "Створити
    // специфікацію" — protecting only the FIRST mesh found per
    // representative is enough to keep that part identifiable/selectable
    // (and keeps its named parent from being pruned, since pruning only
    // removes nodes left with no mesh/children at all), while freeing every
    // OTHER descendant mesh to be instanced normally. Confirmed on the same
    // file: 34,051 -> 3,818 nodes. Desktop keeps full-subtree protection
    // unconditionally — it's the one variant actual part re-export relies
    // on. The AR variant skips this block entirely — see below, it never
    // calls instance() so there's nothing to protect a reference count from.
    protectedMeshNodes = mode === 'mobile'
      ? representativeNodes.map((node) => meshBearingNodesUnder(node, [])[0]).filter(Boolean)
      : representativeNodes.flatMap((node) => meshBearingNodesUnder(node, []));
    for (const node of protectedMeshNodes) {
      const mesh = node.getMesh();
      if (mesh) node.setMesh(mesh.clone());
    }

    // "майже завантажилось але сторінка перегрузилась" (2026-10-09): on a
    // real 1,718-unique-mesh file, the default `min: 5` only instanced
    // meshes repeated 5+ times, leaving 35,586 objects — still a mobile
    // crash. A real test on the same file: `min: 2` (instance ANY mesh
    // shared by 2+ nodes — common for mechanical assemblies full of
    // mirrored/paired parts, not just 5+-times fasteners) cut that to
    // 1,949 (94.5% reduction, vs. 44%). Protected representative meshes
    // above are unaffected either way — their reference count was already
    // dropped to exactly 1 by the `clone()` above, below ANY `min >= 2`.
    // Desktop keeps the conservative default; this lower bar is bundled
    // into the same "only for the lossy mobile variant" scoping as
    // weld/simplify below — it's lossless either way, but kept out of
    // desktop's output rather than silently changing it too.
    await doc.transform(instance(mode === 'mobile' ? { min: 2 } : undefined));
  }
  // "показується не весь виріб а по одній деталі" (2026-10-10): the AR
  // variant deliberately STOPS after `dedup()` — see this file's header
  // comment for why `EXT_mesh_gpu_instancing` (what `instance()` above
  // would write) silently loses every duplicate instance when
  // `@google/model-viewer`'s USDZExporter converts for iOS AR Quick Look.
  // Every node stays a real, individually-walkable glTF node.

  if (mode === 'mobile' || mode === 'ar') {
    const { weld, simplify } = require('@gltf-transform/functions');
    const { MeshoptSimplifier } = require('meshoptimizer');
    await MeshoptSimplifier.ready;
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.01 }),
    );
  }

  const nodeCountAfter = doc.getRoot().listNodes().length;
  console.error(
    `glb-optimize (${label}): ${nodeCountBefore} nodes -> ${nodeCountAfter} nodes (${representativeNodes.length} article representatives protected, ${protectedMeshNodes.length} of their mesh-bearing descendants)`,
  );

  return doc;
}

async function main() {
  const { NodeIO } = require('@gltf-transform/core');
  const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

  // Registering every known extension (not just EXTMeshGPUInstancing) is
  // what `instance()` itself needs to WRITE the extension it attaches —
  // confirmed by a real test: writing without this silently dropped the
  // whole `EXT_mesh_gpu_instancing` block (NodeIO logs "extensions were
  // not registered... will not be written", no error, no crash) — and
  // covers whatever extensions the SOURCE file itself might already use,
  // so round-tripping those isn't a separate thing to get right.
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const inputBytes = fs.readFileSync(inputGlbPath);

  const desktopDoc = await buildOptimizedDoc(io, inputBytes, 'desktop', 'desktop');
  const desktopBytes = await io.writeBinary(desktopDoc);
  fs.writeFileSync(outputGlbPath, Buffer.from(desktopBytes));

  if (mobileOutputGlbPath) {
    const mobileDoc = await buildOptimizedDoc(io, inputBytes, 'mobile', 'mobile');
    const mobileBytes = await io.writeBinary(mobileDoc);
    fs.writeFileSync(mobileOutputGlbPath, Buffer.from(mobileBytes));
  }

  if (arOutputGlbPath) {
    const arDoc = await buildOptimizedDoc(io, inputBytes, 'ar', 'ar');
    const arBytes = await io.writeBinary(arDoc);
    fs.writeFileSync(arOutputGlbPath, Buffer.from(arBytes));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
