#!/usr/bin/env node
// Runs the actual OCCT parse + GLB build in a fully separate OS process —
// see StepConversionService's header comment for why. A real-world STEP
// assembly's WASM tessellation memory use is NOT bounded by Node's own
// --max-old-space-size (that caps only the V8 JS heap, not WebAssembly
// linear memory), so the only reliable way to guarantee a runaway
// conversion can't starve the box this shares with the live API and
// Postgres is to kill the whole process from the outside — instant, full
// memory reclaim — rather than try to constrain it from within. Plain
// CommonJS `require()`, not TypeScript: this is spawned directly via
// `node step-convert-child.js`, no ts-node/build step for a one-file
// child script.

const fs = require('fs');

const [, , stepPath, glbPath] = process.argv;
if (!stepPath || !glbPath) {
  console.error('Usage: node step-convert-child.js <input.step> <output.glb>');
  process.exit(2);
}

// Found via a real test, not chosen up front: even the "coarse" fixed
// setting this used to have (1% bounding-box deflection, same as the
// client-side fallback worker still uses for typical files) produced a
// 518MB .glb for a real 17.4MB assembly dense with small threaded parts
// (bolts, gearbox internals) — both too slow to be worth converting and
// too big for this app's own upload path (nginx's client_max_body_size is
// 50MB) to even store the result. A file's *byte size* doesn't measure
// its tessellation cost directly, but in practice it's the only cheap
// signal available before parsing, and it correlates: a bigger STEP text
// blob generally means more individual solids, which is what actually
// drives triangle count. Scaling deflection up with input size keeps
// small/simple parts at full quality while keeping large/complex
// assemblies inside a size the rest of the pipeline can actually handle.
function pickTessellationParams(stepFileSizeBytes) {
  const MB = 1024 * 1024;
  // "чому у них всіх така рубана форма, і виглядає нереалістично"
  // (2026-11-18): the old 5–15MB tier (0.03/0.8) visibly faceted curved
  // surfaces on perfectly ordinary files — confirmed on a real 5.68MB
  // single-part rod (456066.STEP: 79k verts at 0.03/0.8 vs 140k at
  // 0.01/0.5, visibly smoother) — while costing nothing extra in
  // practice: a real 9.42MB 786-mesh assembly (452330-2.step) produced
  // the IDENTICAL vertex count and was, if anything, slightly FASTER at
  // the fine setting (42.6s vs 48.2s). Merged into the fine tier below
  // 15MB on that evidence. The >=15MB tier is left untouched — THAT is
  // where the real incident this whole function exists for actually
  // happened (a 17.4MB file dense with small threaded parts produced a
  // 518MB .glb at this same fine setting), so the one known bad case
  // still gets the original, deliberately coarse treatment.
  if (stepFileSizeBytes < 15 * MB) {
    return { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.01, angularDeflection: 0.5 };
  }
  return { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.06, angularDeflection: 1.2 };
}

async function main() {
  const occtimportjs = require('occt-import-js');
  const { Document, NodeIO } = require('@gltf-transform/core');

  const occt = await occtimportjs({ locateFile: () => require.resolve('occt-import-js/dist/occt-import-js.wasm') });
  const stepBytes = fs.readFileSync(stepPath);
  const tessellationParams = pickTessellationParams(stepBytes.length);
  const result = occt.ReadStepFile(new Uint8Array(stepBytes), tessellationParams);
  if (!result.success || result.meshes.length === 0) {
    throw new Error('OCCT produced no geometry for this file.');
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  for (const mesh of result.meshes) {
    const primitive = doc.createPrimitive();
    primitive.setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(mesh.attributes.position.array)).setBuffer(buffer),
    );
    if (mesh.attributes.normal) {
      primitive.setAttribute(
        'NORMAL',
        doc.createAccessor().setType('VEC3').setArray(new Float32Array(mesh.attributes.normal.array)).setBuffer(buffer),
      );
    }
    primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(mesh.index.array)).setBuffer(buffer));
    // "чому з степ деталі 3д такі темні і чорні майже нічого не видно"
    // (2026-11-18): a glTF material's own spec default is
    // metallicFactor=1/roughnessFactor=1 — a perfectly smooth, fully
    // metallic surface — which renders almost black under this app's
    // plain directional+hemisphere lighting (no environment map for the
    // metal's reflection to pick up; only a thin specular highlight shows
    // at all). `doc.createMaterial()` was only ever given a base color,
    // never touching those two, so every STEP→GLB conversion inherited
    // that default. Matches the client-side fallback conversion's own
    // values (`step-3d-viewer.tsx`'s `loadStepViaWorker`) for a
    // consistent look regardless of which path produced the GLB. Also
    // always creates a material now (not just when `mesh.color` exists)
    // so a colorless mesh gets the same light-gray/non-metal look instead
    // of the untouched default material (metallic WHITE, same problem).
    const color = mesh.color ?? [0x9c / 255, 0xa3 / 255, 0xaf / 255];
    primitive.setMaterial(doc.createMaterial().setBaseColorFactor([...color, 1]).setMetallicFactor(0.1).setRoughnessFactor(0.7));
    const gltfMesh = doc.createMesh(mesh.name || 'mesh');
    gltfMesh.addPrimitive(primitive);
    scene.addChild(doc.createNode(mesh.name || 'node').setMesh(gltfMesh));
  }

  const glb = await new NodeIO().writeBinary(doc);
  fs.writeFileSync(glbPath, Buffer.from(glb));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
