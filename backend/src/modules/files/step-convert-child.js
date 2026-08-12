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

// Kept in sync with the tessellation quality the client-side fallback
// worker uses (step-parser.worker.ts) — deliberately coarser than OCCT's
// CAD-precision default, which is what made even this isolated child take
// minutes/GBs on a real multi-part assembly. This app only needs "what
// does this part look like", not machining-grade surface accuracy.
const TESSELLATION_PARAMS = { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.01, angularDeflection: 0.5 };

async function main() {
  const occtimportjs = require('occt-import-js');
  const { Document, NodeIO } = require('@gltf-transform/core');

  const occt = await occtimportjs({ locateFile: () => require.resolve('occt-import-js/dist/occt-import-js.wasm') });
  const stepBytes = fs.readFileSync(stepPath);
  const result = occt.ReadStepFile(new Uint8Array(stepBytes), TESSELLATION_PARAMS);
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
    if (mesh.color) {
      primitive.setMaterial(doc.createMaterial().setBaseColorFactor([...mesh.color, 1]));
    }
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
