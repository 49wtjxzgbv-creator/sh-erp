/**
 * `occt-import-js` ships no TypeScript declarations (plain Emscripten glue
 * JS) — this covers only the tiny surface `step-3d-viewer.tsx` actually
 * calls, not the full API.
 */
declare module 'occt-import-js' {
  export interface OcctMesh {
    color?: [number, number, number];
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    index: { array: number[] };
  }
  export interface OcctReadResult {
    success: boolean;
    meshes: OcctMesh[];
  }
  export interface OcctModule {
    ReadStepFile(buffer: Uint8Array, params: unknown): OcctReadResult;
  }
  export type OcctFactory = (opts?: { locateFile?: (path: string) => string }) => Promise<OcctModule>;
  const factory: OcctFactory;
  export default factory;
}
