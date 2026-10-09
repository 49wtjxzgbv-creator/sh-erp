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
// repeated fasteners, so dedup+instance only reduced it to 35,587 objects
// (44%, vs. 98% on the smaller repetitive file), still too many for
// mobile. A SEPARATE "mobile" variant additionally runs `weld()`+
// `simplify()` (meshoptimizer) BEFORE instancing — real mesh decimation,
// fewer vertices/triangles per part, independent of and complementary to
// the node-count reduction above. Desktop keeps full detail (the
// "optimized" output below is unaffected); only the extra mobile output,
// when requested via a 3rd CLI arg, pays this lossy cost. Built from a
// FRESH read of the input bytes each time (gltf-transform's `Document`
// has no built-in deep-clone) so the two outputs never share mutated
// state.

const fs = require('fs');

const [, , inputGlbPath, outputGlbPath, mobileOutputGlbPath] = process.argv;
if (!inputGlbPath || !outputGlbPath) {
  console.error('Usage: node glb-optimize-child.js <input.glb> <output.glb> [mobile-output.glb]');
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

/** Every mesh-bearing node in `node`'s own subtree, `node` itself included — mirrors step-3d-viewer.tsx's `meshesUnder`, just over gltf-transform `Node`s instead of `THREE.Object3D`s. */
function meshBearingNodesUnder(node, out) {
  if (node.getMesh()) out.push(node);
  for (const child of node.listChildren()) meshBearingNodesUnder(child, out);
  return out;
}

/**
 * Reads a FRESH `Document` from `inputBytes` and runs the shared
 * "protect named article representatives, then dedup+instance" pipeline
 * — see the file header for the full reasoning. `simplifyFirst` adds the
 * lossy weld+simplify decimation pass (mobile variant only) before any of
 * that, since simplification should see the original, un-instanced
 * geometry.
 */
async function buildOptimizedDoc(io, inputBytes, simplifyFirst, label) {
  const doc = await io.readBinary(new Uint8Array(inputBytes));

  if (simplifyFirst) {
    const { weld, simplify } = require('@gltf-transform/functions');
    const { MeshoptSimplifier } = require('meshoptimizer');
    await MeshoptSimplifier.ready;
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.01 }),
    );
  }

  const allNodes = doc.getRoot().listNodes();
  const nodeCountBefore = allNodes.length;

  const seenArticles = new Set();
  const representativeNodes = [];
  for (const node of allNodes) {
    const name = (node.getName() || '').trim();
    if (!name || !isArticleCandidateName(name)) continue;
    const article = extractArticleCandidate(name);
    if (seenArticles.has(article)) continue;
    seenArticles.add(article);
    representativeNodes.push(node);
  }

  const { dedup, instance } = require('@gltf-transform/functions');
  await doc.transform(dedup());

  const protectedMeshNodes = representativeNodes.flatMap((node) => meshBearingNodesUnder(node, []));
  for (const node of protectedMeshNodes) {
    const mesh = node.getMesh();
    if (mesh) node.setMesh(mesh.clone());
  }

  await doc.transform(instance());

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

  const desktopDoc = await buildOptimizedDoc(io, inputBytes, false, 'desktop');
  const desktopBytes = await io.writeBinary(desktopDoc);
  fs.writeFileSync(outputGlbPath, Buffer.from(desktopBytes));

  if (mobileOutputGlbPath) {
    const mobileDoc = await buildOptimizedDoc(io, inputBytes, true, 'mobile');
    const mobileBytes = await io.writeBinary(mobileDoc);
    fs.writeFileSync(mobileOutputGlbPath, Buffer.from(mobileBytes));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
