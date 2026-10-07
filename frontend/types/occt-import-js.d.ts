/**
 * `occt-import-js` ships no TypeScript declarations (plain Emscripten glue
 * JS) — this covers only the tiny surface `step-3d-viewer.tsx` actually
 * calls, not the full API.
 */
declare module 'occt-import-js' {
  export interface OcctMesh {
    /** The STEP product/instance name OCCT carried over, if any — same field backend/src/modules/files/step-convert-child.js already reads at runtime (plain untyped JS there, so this gap only ever showed up here). */
    name?: string;
    color?: [number, number, number];
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    index: { array: number[] };
  }
  export interface OcctReadResult {
    success: boolean;
    meshes: OcctMesh[];
  }
  export interface OcctReadParams {
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }
  export interface OcctModule {
    ReadStepFile(buffer: Uint8Array, params: OcctReadParams | null): OcctReadResult;
  }
  export type OcctFactory = (opts?: { locateFile?: (path: string) => string }) => Promise<OcctModule>;
  const factory: OcctFactory;
  export default factory;
}
