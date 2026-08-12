import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileAsset } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createR2Client, R2_BUCKET } from './r2-client';

const STEP_EXTENSION = /\.(step|stp)$/i;

// A real multi-part mechanical assembly can legitimately need several
// minutes and multiple gigabytes of WASM linear memory to tessellate —
// confirmed directly: a 17.4MB real customer file was still running after
// 15+ minutes and 2.7GB RSS on this VPS (3.8GB RAM, shared with the live
// API and Postgres) before being killed by hand during testing, with
// MemAvailable down to ~230MB. A 4GB swap file was added to the VPS after
// that finding specifically to give conversions like this room to
// complete instead of OOM-killing something else — the kernel pages out
// cold/idle memory (e.g. Postgres's own cache) under pressure rather than
// invoking the OOM killer. Both limits below still exist to bound the
// worst case automatically: a file demanding enough to hit either one
// fails conversion cleanly (FAILED status, client-side fallback still
// works) rather than degrading the box indefinitely. RSS is allowed
// higher than physical RAM alone (2.5GB, vs 3.8GB total) precisely
// because swap now exists as backing for the overflow.
const MAX_CONVERSION_MS = 15 * 60 * 1000;
const MAX_CONVERSION_RSS_BYTES = 2.5 * 1024 * 1024 * 1024;
const MEMORY_CHECK_INTERVAL_MS = 3000;

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
 * The actual parse+build (same `occt-import-js` used client-side, plus
 * `@gltf-transform/core` to write the `.glb`) runs in `step-convert-
 * child.js`, spawned as a **separate OS process**, not inline here — see
 * `MAX_CONVERSION_MS`/`MAX_CONVERSION_RSS_BYTES` above for why: a runaway
 * conversion's WASM memory isn't bounded by Node's own
 * `--max-old-space-size` (V8-heap-only), so killing the whole child
 * process from the outside is the only reliable way to guarantee it can't
 * starve the box. Killing this NestJS process itself would take the live
 * API down with it — the child is deliberately expendable, this service
 * is not.
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
    let workDir: string | undefined;
    try {
      await this.setStatus(companyId, id, 'PENDING');

      workDir = await mkdtemp(join(tmpdir(), 'step-convert-'));
      const stepPath = join(workDir, 'input.step');
      const glbPath = join(workDir, 'output.glb');

      const stepBytes = await this.getObjectBytes(storageKey);
      await writeFile(stepPath, stepBytes);

      await runConvertChild(stepPath, glbPath);
      const glb = await readFile(glbPath);

      const convertedStorageKey = storageKey.replace(STEP_EXTENSION, '') + '.glb';
      await this.r2.send(
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: convertedStorageKey, Body: glb, ContentType: 'model/gltf-binary' }),
      );

      await this.setStatus(companyId, id, 'DONE', convertedStorageKey);
      this.logger.log(`Converted ${originalName} (${id}) to GLB (${glb.byteLength} bytes).`);
    } catch (err) {
      this.logger.error(`Failed to convert ${originalName} (${id}) to GLB: ${err instanceof Error ? err.message : String(err)}`);
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

/**
 * Spawns `step-convert-child.js` (copied next to the compiled service by
 * `nest-cli.json`'s `assets` config — plain `.js`, not part of the TS
 * build) and enforces both limits externally: a wall-clock timeout, and a
 * periodic `/proc/<pid>/status` RSS check (Linux-only — a no-op elsewhere,
 * e.g. `npm run build` running on a contributor's Mac, since production is
 * what actually needs this guard). Either limit kills the child with
 * SIGKILL; the promise rejects, `convert()`'s catch marks the row FAILED.
 */
function runConvertChild(stepPath: string, glbPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const childScript = join(__dirname, 'step-convert-child.js');
    const child = spawn(process.execPath, [childScript, stepPath, glbPath], { stdio: ['ignore', 'ignore', 'pipe'] });

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
      settle(new Error(`Conversion exceeded ${MAX_CONVERSION_MS / 1000}s and was terminated.`));
    }, MAX_CONVERSION_MS);

    const memoryCheckHandle = setInterval(async () => {
      const rss = await readProcessRssBytes(child.pid);
      if (rss !== undefined && rss > MAX_CONVERSION_RSS_BYTES) {
        child.kill('SIGKILL');
        settle(new Error(`Conversion exceeded ${(MAX_CONVERSION_RSS_BYTES / 1024 / 1024 / 1024).toFixed(1)}GB RSS and was terminated.`));
      }
    }, MEMORY_CHECK_INTERVAL_MS);

    child.on('error', (err) => settle(err));
    child.on('exit', (code) => {
      if (settled) return;
      if (code === 0) settle();
      else settle(new Error(`step-convert-child exited with code ${code}: ${stderr.trim() || '(no stderr)'}`));
    });
  });
}

/** Linux-only (`/proc`) — returns `undefined` anywhere else (dev machines) rather than throwing, since the memory guard is a production-VPS safety net, not a cross-platform requirement. */
async function readProcessRssBytes(pid: number | undefined): Promise<number | undefined> {
  if (!pid || process.platform !== 'linux') return undefined;
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : undefined;
  } catch {
    return undefined; // process already exited between the interval tick and the read
  }
}
