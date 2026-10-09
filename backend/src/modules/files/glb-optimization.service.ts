import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileAsset } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createR2Client, R2_BUCKET } from './r2-client';

const GLB_EXTENSION = /\.glb$/i;

// Same reasoning, same numbers, as StepConversionService's own header
// comment — this spawns gltf-transform's `instance()` pass (real
// CPU/memory work over a 34,257-node document in one case), not raw CAD
// tessellation, but the "kill the child, not this process" justification
// is identical.
const MAX_OPTIMIZATION_MS = 10 * 60 * 1000;
const MAX_OPTIMIZATION_RSS_BYTES = 2.5 * 1024 * 1024 * 1024;
const MEMORY_CHECK_INTERVAL_MS = 3000;

/**
 * "ціль щоб з телефона також відкривалось" (2026-10-09): a directly-
 * uploaded .glb from a CAD export can have tens of thousands of
 * scene-graph nodes despite a modest byte size — a real file came in at
 * 10MB/34,257 nodes/only 54 unique meshes, and mobile Safari/WebKit
 * crashed building that many THREE.Object3D instances (confirmed: the
 * crash happened right as GLTFLoader finished building the scene graph,
 * independent of download speed, compression, or anything else tried
 * first). GPU-instancing (`@gltf-transform/functions`'s `dedup()`+
 * `instance()`, run in `glb-optimize-child.js`) collapses repeated-mesh
 * nodes into `EXT_mesh_gpu_instancing` groups — three.js's GLTFLoader
 * already builds one `THREE.InstancedMesh` per group natively, no client
 * change needed. Verified on the real 34,257-node file this was built
 * for: 681 objects after (98%+ reduction), every article's own node name
 * preserved, geometry/bounding box intact.
 *
 * Same "fire-and-forget right after upload, own try/catch persists status
 * onto the row, separate OS process so a runaway pass can only be killed
 * from outside" shape as `StepConversionService` — see that class's
 * header comment for the fuller reasoning, all of which applies here
 * unchanged. Kept as a DISTINCT service/status pair
 * (`optimizationStatus`/`optimizedStorageKey`, not reusing
 * `conversionStatus`/`convertedStorageKey`) because the two jobs answer
 * different questions and a file can independently need either, both, or
 * neither — a STEP file gets converted to .glb AND could separately need
 * optimizing; a directly-uploaded .glb skips conversion entirely but
 * still needs optimizing.
 */
@Injectable()
export class GlbOptimizationService {
  private readonly logger = new Logger(GlbOptimizationService.name);
  private readonly r2 = createR2Client();

  constructor(private readonly prisma: PrismaService) {}

  isGlbFile(originalName: string): boolean {
    return GLB_EXTENSION.test(originalName);
  }

  /** Fire-and-forget entry point — see class header comment. Never throws; every failure path ends in a FAILED row update instead, leaving the original .glb as the only (still fully usable) version. */
  async optimize(fileAsset: FileAsset): Promise<void> {
    const { id, companyId, storageKey, originalName } = fileAsset;
    let workDir: string | undefined;
    try {
      await this.setStatus(companyId, id, 'PENDING');

      workDir = await mkdtemp(join(tmpdir(), 'glb-optimize-'));
      const inputPath = join(workDir, 'input.glb');
      const outputPath = join(workDir, 'output.glb');

      const inputBytes = await this.getObjectBytes(storageKey);
      await writeFile(inputPath, inputBytes);

      await runOptimizeChild(inputPath, outputPath);
      const optimized = await readFile(outputPath);

      const optimizedStorageKey = storageKey.replace(GLB_EXTENSION, '') + '.optimized.glb';
      await this.r2.send(
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: optimizedStorageKey, Body: optimized, ContentType: 'model/gltf-binary' }),
      );

      await this.setStatus(companyId, id, 'DONE', optimizedStorageKey);
      this.logger.log(`Optimized ${originalName} (${id}): ${inputBytes.byteLength} -> ${optimized.byteLength} bytes.`);
    } catch (err) {
      this.logger.error(`Failed to optimize ${originalName} (${id}): ${err instanceof Error ? err.message : String(err)}`);
      await this.setStatus(companyId, id, 'FAILED').catch(() => undefined);
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
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

  /** Same "own transaction, set app.current_company_id directly" pattern as `StepConversionService#setStatus` — see that method's header comment for why (fire-and-forget, no ambient request/userId context). */
  private async setStatus(
    companyId: string,
    fileAssetId: string,
    optimizationStatus: 'PENDING' | 'DONE' | 'FAILED',
    optimizedStorageKey?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);
      await tx.fileAsset.update({
        where: { id: fileAssetId },
        data: { optimizationStatus, ...(optimizedStorageKey ? { optimizedStorageKey } : {}) },
      });
    });
  }
}

/**
 * Spawns `glb-optimize-child.js` (copied next to the compiled service by
 * `nest-cli.json`'s `assets` config, same as `step-convert-child.js`) and
 * enforces both limits externally — identical mechanism to
 * `StepConversionService`'s own `runConvertChild`, see that function's
 * header comment for the full reasoning.
 */
function runOptimizeChild(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const childScript = join(__dirname, 'glb-optimize-child.js');
    const child = spawn(process.execPath, ['--max-old-space-size=4096', childScript, inputPath, outputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));

    let settled = false;
    function settle(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(memoryCheckHandle);
      if (err) reject(err);
      else resolve();
    }

    const timeoutHandle = setTimeout(() => {
      child.kill('SIGKILL');
      settle(new Error(`Optimization exceeded ${MAX_OPTIMIZATION_MS / 1000}s and was terminated.`));
    }, MAX_OPTIMIZATION_MS);

    const memoryCheckHandle = setInterval(async () => {
      const rss = await readProcessRssBytes(child.pid);
      if (rss !== undefined && rss > MAX_OPTIMIZATION_RSS_BYTES) {
        child.kill('SIGKILL');
        settle(new Error(`Optimization exceeded ${(MAX_OPTIMIZATION_RSS_BYTES / 1024 / 1024 / 1024).toFixed(1)}GB RSS and was terminated.`));
      }
    }, MEMORY_CHECK_INTERVAL_MS);

    child.on('error', (err) => settle(err));
    child.on('exit', (code) => {
      if (settled) return;
      if (code === 0) settle();
      else settle(new Error(`glb-optimize-child exited with code ${code}: ${stderr.trim() || '(no stderr)'}`));
    });
  });
}

/** Linux-only (`/proc`) — returns `undefined` anywhere else (dev machines), same as `StepConversionService`'s own copy of this helper. */
async function readProcessRssBytes(pid: number | undefined): Promise<number | undefined> {
  if (!pid || process.platform !== 'linux') return undefined;
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : undefined;
  } catch {
    return undefined;
  }
}
