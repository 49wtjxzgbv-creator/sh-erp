/**
 * Backfill for the real bug fixed in step-convert-child.js (2026-11-18,
 * "чому з степ деталі 3д такі темні і чорні майже нічого не видно"):
 * every STEP→GLB conversion done before that fix wrote a glTF material
 * with ONLY `baseColorFactor` set, leaving `metallicFactor`/
 * `roughnessFactor` at the glTF spec default of 1.0/1.0 — a perfectly
 * smooth, fully metallic surface, which renders almost black under this
 * app's plain directional+hemisphere lighting (no environment map for a
 * metal's reflection to pick up). The fix itself only changes how FUTURE
 * conversions are built — every STEP file already converted (cached
 * forever in R2 under `FileAsset.convertedStorageKey`, see
 * `StepConversionService`'s header comment on why it's a one-time job)
 * keeps serving the old, dark .glb until re-converted.
 *
 * For every FileAsset with `conversionStatus = 'DONE'` and a `.step`/
 * `.stp` original name: re-downloads the ORIGINAL STEP bytes (not the
 * stale .glb), re-runs the same `step-convert-child.js` used by
 * `StepConversionService#convert` (now fixed), and overwrites the SAME
 * `convertedStorageKey` in R2 — no DB row changes needed, the row already
 * points at the right key, only its content changes. Loops every company
 * via the same RLS-activation pattern as the other one-off scripts here.
 *
 * DRY_RUN by default (lists what would be reconverted, no writes).
 * APPLY=1 writes. This re-tessellates every affected file from scratch
 * (same WASM/OCCT cost as the original conversion) — expect it to take a
 * while for companies with many STEP uploads; run it on the VPS where
 * StepConversionService's own memory/time guards are tuned for, not on a
 * contributor's laptop.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createR2Client, R2_BUCKET } from '../src/modules/files/r2-client';

const APPLY = process.env.APPLY === '1';
const STEP_EXTENSION = /\.(step|stp)$/i;
const CONVERT_CHILD_PATH = join(__dirname, '..', 'src', 'modules', 'files', 'step-convert-child.js');
const MAX_CONVERSION_MS = 15 * 60 * 1000;

function runConvertChild(stepPath: string, glbPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=4096', CONVERT_CHILD_PATH, stepPath, glbPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    const timeoutHandle = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Conversion exceeded ${MAX_CONVERSION_MS / 1000}s and was terminated.`));
    }, MAX_CONVERSION_MS);
    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timeoutHandle);
      if (code === 0) resolve();
      else reject(new Error(`step-convert-child.js exited with code ${code}: ${stderr.trim() || '(no stderr)'}`));
    });
  });
}

async function getObjectBytes(r2: ReturnType<typeof createR2Client>, storageKey: string): Promise<Buffer> {
  const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
  const chunks: Buffer[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AWS SDK v3's Body is a Node Readable at runtime for this client.
  for await (const chunk of object.Body as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const prisma = new PrismaClient();
  const r2 = createR2Client();
  try {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });

    let totalReconverted = 0;
    let totalFailed = 0;

    for (const company of companies) {
      const candidates = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${company.id}'`);
        const rows = await tx.fileAsset.findMany({
          where: { conversionStatus: 'DONE', convertedStorageKey: { not: null }, deletedAt: null },
          select: { id: true, originalName: true, storageKey: true, convertedStorageKey: true },
        });
        return rows.filter((r) => STEP_EXTENSION.test(r.originalName));
      });
      if (candidates.length === 0) continue;

      console.log(`=== ${company.name} (${company.id}) — ${candidates.length} converted STEP file(s) ===`);

      for (const file of candidates) {
        console.log(`  ${file.originalName} (${file.id})${APPLY ? ' — reconverting...' : ''}`);
        if (!APPLY) continue;

        let workDir: string | undefined;
        try {
          workDir = await mkdtemp(join(tmpdir(), 'step-reconvert-'));
          const stepPath = join(workDir, 'input.step');
          const glbPath = join(workDir, 'output.glb');

          const stepBytes = await getObjectBytes(r2, file.storageKey);
          await writeFile(stepPath, stepBytes);

          await runConvertChild(stepPath, glbPath);
          const glb = await readFile(glbPath);

          await r2.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: file.convertedStorageKey!,
              Body: glb,
              ContentType: 'model/gltf-binary',
            }),
          );
          console.log(`    OK (${glb.byteLength} bytes)`);
          totalReconverted++;
        } catch (err) {
          console.log(`    FAILED: ${err instanceof Error ? err.message : String(err)}`);
          totalFailed++;
        } finally {
          if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }

    console.log(`\n=== ${APPLY ? 'APPLIED' : 'DRY RUN'} ===`);
    console.log(`Reconverted: ${totalReconverted}`);
    if (totalFailed > 0) console.log(`FAILED (kept the old .glb, unchanged): ${totalFailed}`);
    if (!APPLY) console.log('\nDRY RUN — re-run with APPLY=1 to actually reconvert and overwrite the stored .glb files.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
