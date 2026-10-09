/**
 * "так а до цього як він завантажувався вчора" (2026-10-09): doesn't
 * answer WHY a borderline file crashed today when it didn't yesterday —
 * borderline mobile memory is inherently non-deterministic (depends on
 * everything else running on the device at that exact moment; one real
 * report involved 41 other open tabs) — this instead makes the crash
 * IMPOSSIBLE for a model this node-dense, regardless of what tips it
 * over on any given day.
 *
 * Reads just enough of a .glb via two small Range requests — its 12-byte
 * header plus the length of its own first (JSON) chunk, then that chunk
 * alone — to count `nodes` without downloading or parsing the whole
 * file. A real 10MB assembly (440158.glb) came in at 34,257 nodes
 * despite its modest file size — GLTFLoader has to build one
 * THREE.Object3D per node, and that peak, right as the scene graph
 * finishes building, is what a real mobile crash report traced to (not
 * the file's byte size, which a separate size-based guard already
 * handles). Deliberately has NO three.js dependency, unlike
 * `step-3d-viewer.tsx` — so callers that only need this pre-check (e.g.
 * `assembly-parts-check.tsx`, the light tab wrapper) don't pull three.js
 * into their own bundle just to decide whether to lazy-load the heavy
 * viewer at all.
 */
export async function peekGlbNodeCount(glbUrl: string): Promise<number | null> {
  try {
    const headerRes = await fetch(glbUrl, { headers: { Range: 'bytes=0-19' } });
    if (!headerRes.ok) return null;
    const headerBuf = await headerRes.arrayBuffer();
    if (headerBuf.byteLength < 20) return null;
    const view = new DataView(headerBuf);
    if (view.getUint32(0, true) !== 0x46546c67) return null; // magic 'glTF'
    const chunkLength = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a) return null; // first chunk type 'JSON'
    if (chunkLength <= 0 || chunkLength > 64 * 1024 * 1024) return null; // sanity cap — a malformed/unexpected file, not a real glTF JSON chunk

    const jsonRes = await fetch(glbUrl, { headers: { Range: `bytes=20-${20 + chunkLength - 1}` } });
    if (!jsonRes.ok) return null;
    const json = JSON.parse(await jsonRes.text());
    return Array.isArray(json.nodes) ? json.nodes.length : 0;
  } catch {
    return null; // fail OPEN — an inconclusive check shouldn't block a load that might be perfectly fine
  }
}

/** Comfortably below the confirmed-crashing 34,257-node file; ordinary single/few-part product models are nowhere near this. */
export const MOBILE_NODE_COUNT_LIMIT = 10_000;
