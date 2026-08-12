import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Document, NodeIO } from '@gltf-transform/core';
import type { FileAsset } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createR2Client, R2_BUCKET } from './r2-client';

const STEP_EXTENSION = /\.(step|stp)$/i;

/**
 * A STEP file is a raw CAD B-rep format — every viewer open re-tessellates
 * it from scratch (`step-3d-viewer.tsx`'s client-side `occt-import-js`
 * path), which is fine for a small part but took several minutes on a real
 * 16.6MB multi-part assembly (confirmed live: still parsing well past a
 * 3-minute, then a 10-minute, timeout before this service existed) — no
 * amount of client-side tessellation-quality tuning fixes that, because
 * the actual bottleneck is CAD parsing complexity, not mesh density alone.
 *
 * This converts a STEP file to a compact `.glb` **once**, server-side,
 * fire-and-forget right after upload (same "not awaited, own try/catch
 * persists status onto the row itself" pattern as
 * `legacy-import.service.ts#startImport`/`runImportJob` — see that
 * class's header comment for why: a multi-minute conversion has no
 * business blocking an HTTP response). Every later view of that document
 * then loads the small, pre-tessellated `.glb` directly via three.js's
 * standard `GLTFLoader` — no WASM, no re-parsing, effectively instant
 * regardless of how large or complex the original STEP file was.
 *
 * Uses the SAME `occt-import-js` used client-side, just running under
 * plain Node instead of in a browser Worker (Emscripten's glue code
 * branches on `ENVIRONMENT_IS_NODE` and works unmodified — confirmed
 * directly before building this). `@gltf-transform/core` builds the
 * actual `.glb` binary from OCCT's raw position/normal/index arrays —
 * chosen over three.js's own `GLTFExporter` (browser/DOM-oriented) or a
 * hand-rolled binary format (glTF is a real, tool-portable standard other
 * software can also open, and `GLTFLoader` on the frontend is simpler and
 * more battle-tested than the manual `BufferGeometry` assembly the
 * client-side fallback path still does for not-yet-converted files).
 */
@Injectable()
export class StepConversionService {
  private readonly logger = new Logger(StepConversionService.name);
  private readonly r2 = createR2Client();

  constructor(private readonly prisma: PrismaService) {}

  isStepFile(originalName: string): boolean {
    return STEP_EXTENSION.test(originalName);
  }

  /** Fire-and-forget entry point — see class header comment. Never throws; every failure path ends in a FAILED row update instead. */
  async convert(fileAsset: FileAsset): Promise<void> {
    const { id, companyId, storageKey, originalName } = fileAsset;
    try {
      await this.setStatus(companyId, id, 'PENDING');

      const stepBytes = await this.getObjectBytes(storageKey);
      const occt = await loadOcct();
      const result = occt.ReadStepFile(new Uint8Array(stepBytes), TESSELLATION_PARAMS);
      if (!result.success || result.meshes.length === 0) {
        throw new Error('OCCT produced no geometry for this file.');
      }

      const glb = await buildGlb(result);
      const convertedStorageKey = storageKey.replace(STEP_EXTENSION, '') + '.glb';
      await this.r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: convertedStorageKey,
          Body: glb,
          ContentType: 'model/gltf-binary',
        }),
      );

      await this.setStatus(companyId, id, 'DONE', convertedStorageKey);
      this.logger.log(`Converted ${originalName} (${id}) to GLB (${glb.byteLength} bytes).`);
    } catch (err) {
      this.logger.error(`Failed to convert ${originalName} (${id}) to GLB: ${err instanceof Error ? err.message : String(err)}`);
      await this.setStatus(companyId, id, 'FAILED').catch(() => undefined);
    }
  }

  private async getObjectBytes(storageKey: string): Promise<Buffer> {
    const object = await this.r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
    const chunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AWS SDK v3's Body is a Node Readable at runtime for this client, but typed as a union across browser/Node targets.
    for await (const chunk of object.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Opens its own transaction and sets only `app.current_company_id`
   * directly, same as `AuditService.record()` (see that method's header
   * comment) — this runs fire-and-forget outside any request's tenant
   * context (no ambient `userId` available), and `file_assets`' RLS policy
   * only needs `app.current_company_id` set, not a user.
   */
  private async setStatus(
    companyId: string,
    fileAssetId: string,
    conversionStatus: 'PENDING' | 'DONE' | 'FAILED',
    convertedStorageKey?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);
      await tx.fileAsset.update({
        where: { id: fileAssetId },
        data: { conversionStatus, ...(convertedStorageKey ? { convertedStorageKey } : {}) },
      });
    });
  }
}

const TESSELLATION_PARAMS = { linearDeflectionType: 'bounding_box_ratio' as const, linearDeflection: 0.01, angularDeflection: 0.5 };

let occtPromise: ReturnType<typeof loadOcctUncached> | undefined;
function loadOcct() {
  if (!occtPromise) occtPromise = loadOcctUncached();
  return occtPromise;
}
async function loadOcctUncached() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- occt-import-js ships no ESM build; require() is its documented Node entry point.
  const occtimportjs = require('occt-import-js');
  return occtimportjs({ locateFile: () => require.resolve('occt-import-js/dist/occt-import-js.wasm') });
}

interface OcctMesh {
  name?: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
interface OcctReadResult {
  success: boolean;
  meshes: OcctMesh[];
}

async function buildGlb(result: OcctReadResult): Promise<Uint8Array> {
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
      const material = doc.createMaterial().setBaseColorFactor([...mesh.color, 1]);
      primitive.setMaterial(material);
    }

    const gltfMesh = doc.createMesh(mesh.name ?? 'mesh');
    gltfMesh.addPrimitive(primitive);
    scene.addChild(doc.createNode(mesh.name ?? 'node').setMesh(gltfMesh));
  }

  return new NodeIO().writeBinary(doc);
}
