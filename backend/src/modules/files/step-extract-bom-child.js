#!/usr/bin/env node
// Same "separate OS process, let the parent enforce timeout/RSS limits
// externally" reasoning as step-convert-child.js's own header comment —
// reused verbatim here. This script does NOT build a GLB at all; it only
// reads OCCT's assembly-tree structure (`result.root`), which
// step-convert-child.js parses but discards (uses only `result.meshes`).
// Plain CommonJS, spawned directly — no build step for a one-file child.
//
// The pure tree-walking/grouping logic below is exported (`module.exports`)
// so it's unit-testable from a real Jest spec (step-extract-bom-child.spec.ts,
// `require()`d directly — plain CommonJS interop, no ts-jest transform
// needed) without spawning a process or touching the real OCCT/WASM
// bindings. `main()` only runs when this file is executed directly (the
// `require.main === module` guard below), never when required as a module.

const fs = require('fs');

// Coarsest tier from step-convert-child.js's own pickTessellationParams —
// deliberately fixed, not scaled by file size: this script never renders
// the mesh, it only needs a bounding box per part, so tessellation quality
// doesn't matter and the coarsest setting is the fastest one.
const TESSELLATION_PARAMS = { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.06, angularDeflection: 1.2 };

/**
 * STEP files are conventionally authored in millimeters, and occt-import-js
 * passes coordinates through unchanged — same assumption step-convert-
 * child.js's GLB output and the client-side viewer already make implicitly.
 * This is a geometry-derived approximation (min/max of the mesh's own
 * vertices), not the drawing's own dimension annotations — labeled as such
 * in the output so a reviewer doesn't mistake it for an authoritative value.
 */
function computeBoundingBoxCm(positionArray) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positionArray.length; i += 3) {
    const x = positionArray[i];
    const y = positionArray[i + 1];
    const z = positionArray[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const toCm = (mm) => Math.round((mm / 10) * 10) / 10;
  return { lengthCm: toCm(maxX - minX), widthCm: toCm(maxY - minY), heightCm: toCm(maxZ - minZ) };
}

// ----------------------------------------------------------------------------
// Irregular-shape nesting (2026-11-01) — extracts the real 2D contour (outer
// boundary + any holes) of a part's dominant FLAT face, instead of just its
// bounding box. Relies on a real, empirically-verified occt-import-js output
// field: `mesh.brep_faces: {first, last}[]` maps triangle-index ranges back
// to the ORIGINAL B-rep face each triangle came from — so the part's main
// flat surface (as opposed to its thin side walls) can be identified
// reliably, not guessed from a triangle soup. Standard, well-defined
// computational-geometry technique: an edge used by exactly ONE triangle
// within one face's own triangle subset is a boundary edge (true for any
// manifold-with-boundary triangulation); chaining those into closed loops
// gives the outer contour (largest loop) and any holes (smaller loops
// nested inside it, e.g. a punched circle) — topology-based, so concave
// shapes work correctly with no special-casing.
// ----------------------------------------------------------------------------

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vecCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function vecLen(a) {
  return Math.sqrt(vecDot(a, a));
}
function vecNormalize(a) {
  const l = vecLen(a);
  return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}
function vecScale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function getVertex(positionArray, i) {
  return [positionArray[i * 3], positionArray[i * 3 + 1], positionArray[i * 3 + 2]];
}
function triangleVertexIndices(indexArray, triIdx) {
  return [indexArray[triIdx * 3], indexArray[triIdx * 3 + 1], indexArray[triIdx * 3 + 2]];
}
function triangleNormal(positionArray, indexArray, triIdx) {
  const [i0, i1, i2] = triangleVertexIndices(indexArray, triIdx);
  const e1 = vecSub(getVertex(positionArray, i1), getVertex(positionArray, i0));
  const e2 = vecSub(getVertex(positionArray, i2), getVertex(positionArray, i0));
  return vecCross(e1, e2); // unnormalized — magnitude/2 is the triangle's area
}

// Tolerance for "every triangle in this face shares the same normal" —
// generous (~11° off exact) to absorb tessellation noise on a nominally
// flat face; `Math.abs` tolerates a flipped winding between triangles
// (irrelevant here — boundary detection below is undirected-edge-based,
// so winding direction never matters).
const PLANAR_DOT_TOLERANCE = 0.98;

/** One candidate planar face per `brep_faces` segment, with its reference normal and total triangle area (for picking the dominant one). */
function analyzeFaces(positionArray, indexArray, brepFaces) {
  const faces = [];
  for (const bf of brepFaces) {
    const triIndices = [];
    for (let t = bf.first; t <= bf.last; t++) triIndices.push(t);
    if (triIndices.length === 0) continue;

    let refNormal = null;
    let totalArea = 0;
    const normals = [];
    for (const t of triIndices) {
      const n = triangleNormal(positionArray, indexArray, t);
      const len = vecLen(n);
      if (len < 1e-9) continue; // degenerate triangle (zero area) — skip, doesn't affect planarity
      totalArea += len / 2;
      const nn = vecScale(n, 1 / len);
      normals.push(nn);
      if (!refNormal) refNormal = nn;
    }
    if (!refNormal || normals.length === 0) continue;

    const isPlanar = normals.every((n) => Math.abs(vecDot(n, refNormal)) > PLANAR_DOT_TOLERANCE);
    if (!isPlanar) continue;

    faces.push({ triIndices, normal: refNormal, area: totalArea });
  }
  return faces;
}

function pickDominantFlatFace(faces) {
  if (faces.length === 0) return null;
  return faces.reduce((best, f) => (f.area > best.area ? f : best), faces[0]);
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Edges used by exactly one triangle within this face's own triangle subset — the face's boundary (outer contour + any hole loops), undirected. */
function findBoundaryEdges(indexArray, triIndices) {
  const edgeCount = new Map();
  const edgeVerts = new Map();
  for (const t of triIndices) {
    const [i0, i1, i2] = triangleVertexIndices(indexArray, t);
    for (const [a, b] of [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ]) {
      const key = edgeKey(a, b);
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      if (!edgeVerts.has(key)) edgeVerts.set(key, [a, b]);
    }
  }
  const boundary = [];
  for (const [key, count] of edgeCount) {
    if (count === 1) boundary.push(edgeVerts.get(key));
  }
  return boundary;
}

/**
 * Chains undirected boundary edges into closed vertex-index loops. A greedy
 * walk, not a full topological solver — correct for the well-formed case
 * (every boundary vertex touches exactly 2 boundary edges, true for any
 * clean B-rep face tessellation) and simply abandons a loop that doesn't
 * close rather than looping forever on malformed/degenerate input.
 */
function chainBoundaryLoops(boundaryEdges) {
  const adjacency = new Map();
  for (const [a, b] of boundaryEdges) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  const visitedEdges = new Set();
  const loops = [];
  for (const [startA, startB] of boundaryEdges) {
    const startKey = edgeKey(startA, startB);
    if (visitedEdges.has(startKey)) continue;

    const loop = [startA];
    let prev = startA;
    let current = startB;
    visitedEdges.add(startKey);
    const safetyLimit = boundaryEdges.length + 10;
    let steps = 0;

    while (current !== startA && steps < safetyLimit) {
      loop.push(current);
      const neighbors = adjacency.get(current) || [];
      let next = neighbors.find((n) => n !== prev && !visitedEdges.has(edgeKey(current, n)));
      if (next === undefined) next = neighbors.find((n) => !visitedEdges.has(edgeKey(current, n)));
      if (next === undefined) break; // dead end — malformed boundary, abandon this loop

      visitedEdges.add(edgeKey(current, next));
      prev = current;
      current = next;
      steps++;
    }

    if (current === startA && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function buildBasis(normal) {
  const arbitrary = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = vecNormalize(vecCross(arbitrary, normal));
  const v = vecNormalize(vecCross(normal, u));
  return { u, v };
}

function projectLoopTo2D(positionArray, loopIndices, origin, u, v) {
  return loopIndices.map((idx) => {
    const rel = vecSub(getVertex(positionArray, idx), origin);
    return [vecDot(rel, u), vecDot(rel, v)];
  });
}

function signedArea2D(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function toCmPoints(pointsMm) {
  return pointsMm.map(([x, y]) => [Math.round(x * 0.1 * 100) / 100, Math.round(y * 0.1 * 100) / 100]);
}

/**
 * Pure core: a mesh (with `attributes.position`, `index`, `brep_faces`) ->
 * `{ outerCm, holesCm }` for its dominant flat face, or `null` when no
 * clean planar face is found (curved/non-flat part — honest degradation,
 * same spirit as `dimensionsCm`'s own "за геометрією" caveat: the caller
 * falls back to the existing bounding-box-only output in that case).
 */
function extractFlatFaceOutline(mesh) {
  if (!mesh || !mesh.attributes || !mesh.attributes.position || !mesh.index || !mesh.brep_faces) return null;

  const positionArray = mesh.attributes.position.array;
  const indexArray = mesh.index.array;

  const faces = analyzeFaces(positionArray, indexArray, mesh.brep_faces);
  const dominant = pickDominantFlatFace(faces);
  if (!dominant) return null;

  const boundaryEdges = findBoundaryEdges(indexArray, dominant.triIndices);
  const loops = chainBoundaryLoops(boundaryEdges);
  if (loops.length === 0) return null;

  const { u, v } = buildBasis(dominant.normal);
  const origin = getVertex(positionArray, loops[0][0]);
  const projectedLoopsCm = loops.map((loop) => toCmPoints(projectLoopTo2D(positionArray, loop, origin, u, v)));
  const areas = projectedLoopsCm.map((pts) => Math.abs(signedArea2D(pts)));

  let outerIdx = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[outerIdx]) outerIdx = i;

  return {
    outerCm: projectedLoopsCm[outerIdx],
    holesCm: projectedLoopsCm.filter((_, i) => i !== outerIdx),
  };
}

/**
 * Walks OCCT's assembly tree collecting one entry per LEAF node that owns
 * geometry (`meshes.length > 0`) at any depth — that's what a real STEP
 * assembly's NEXT_ASSEMBLY_USAGE_OCCURRENCE structure actually encodes as
 * "one physical instance of this part". Intermediate sub-assembly nodes
 * with no meshes of their own are walked through, not counted.
 */
function collectLeaves(node, out) {
  if (node.meshes && node.meshes.length > 0) {
    out.push({ name: node.name || '(без назви)', meshIndex: node.meshes[0] });
  }
  for (const child of node.children || []) {
    collectLeaves(child, out);
  }
}

/** Pure core: OCCT's raw `ReadStepFile` result -> grouped `{name, qty, dimensionsCm}[]`. No I/O, no WASM calls — everything that needs `occt-import-js` itself stays in `main()` below. */
function groupResultIntoBomLines(result) {
  const leaves = [];
  if (result.root) {
    collectLeaves(result.root, leaves);
  }
  // A file with no assembly tree at all but real mesh geometry (OCCT
  // returned no `root`, or `root` itself has zero children and zero
  // meshes) — fall back to one line per mesh, ungrouped by name.
  if (leaves.length === 0 && result.meshes.length > 0) {
    result.meshes.forEach((mesh, i) => leaves.push({ name: mesh.name || '(без назви)', meshIndex: i }));
  }

  const grouped = new Map();
  for (const leaf of leaves) {
    const existing = grouped.get(leaf.name);
    if (existing) {
      existing.qty += 1;
      continue;
    }
    const mesh = result.meshes[leaf.meshIndex];
    const bbox = mesh && mesh.attributes && mesh.attributes.position ? computeBoundingBoxCm(mesh.attributes.position.array) : null;
    // Irregular-shape nesting (2026-11-01): the real contour of the part's
    // dominant flat face, when one can be found — `null` for curved/non-flat
    // parts, which keeps using the bounding box above exactly as before.
    const outline = mesh ? extractFlatFaceOutline(mesh) : null;
    grouped.set(leaf.name, {
      name: leaf.name,
      qty: 1,
      dimensionsCm: bbox ? `${bbox.lengthCm}×${bbox.widthCm}×${bbox.heightCm} см (за геометрією)` : null,
      // Структуровані числа (2026-10-31, "розкрій") — та сама bounding-box
      // геометрія, що й dimensionsCm вище, але як числа, щоб UI міг
      // автопідставити довжину/розмір деталі в поля розкрою компонента
      // специфікації без парсингу вільного тексту. Та сама засторога, що й
      // для dimensionsCm: це габарит по геометрії, не офіційний розмір з
      // креслення.
      lengthCm: bbox ? bbox.lengthCm : null,
      widthCm: bbox ? bbox.widthCm : null,
      heightCm: bbox ? bbox.heightCm : null,
      shapeKind: outline ? 'polygon' : 'bbox',
      outerCm: outline ? outline.outerCm : null,
      holesCm: outline ? outline.holesCm : null,
    });
  }

  return Array.from(grouped.values());
}

async function main() {
  const [, , stepPath, outputPath] = process.argv;
  if (!stepPath || !outputPath) {
    console.error('Usage: node step-extract-bom-child.js <input.step> <output.json>');
    process.exit(2);
  }

  const occtimportjs = require('occt-import-js');
  const occt = await occtimportjs({ locateFile: () => require.resolve('occt-import-js/dist/occt-import-js.wasm') });
  const stepBytes = fs.readFileSync(stepPath);
  const result = occt.ReadStepFile(new Uint8Array(stepBytes), TESSELLATION_PARAMS);
  if (!result.success) {
    throw new Error('OCCT не зміг розпізнати цей STEP-файл.');
  }

  const lines = groupResultIntoBomLines(result);
  fs.writeFileSync(outputPath, JSON.stringify(lines));
}

module.exports = { computeBoundingBoxCm, collectLeaves, groupResultIntoBomLines, extractFlatFaceOutline };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
