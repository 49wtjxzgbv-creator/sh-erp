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
    grouped.set(leaf.name, {
      name: leaf.name,
      qty: 1,
      dimensionsCm: bbox ? `${bbox.lengthCm}×${bbox.widthCm}×${bbox.heightCm} см (за геометрією)` : null,
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

module.exports = { computeBoundingBoxCm, collectLeaves, groupResultIntoBomLines };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
