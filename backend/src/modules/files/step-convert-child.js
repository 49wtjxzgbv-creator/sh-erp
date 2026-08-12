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
  if (stepFileSizeBytes < 5 * MB) {
    return { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.01, angularDeflection: 0.5 };
  }
  if (stepFileSizeBytes < 15 * MB) {
    return { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.03, angularDeflection: 0.8 };
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
