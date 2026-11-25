/**
 * Read-only diagnostic (2026-11-25 — "не всі 3д моделі виробів
 * відкриваються по центру екрана та не приближуються наскільки того
 * хочеться", real assemblies 457185/457243): prints the real world-space
 * bounding box of each matching assembly's 3D model, to confirm/refute
 * "these are just extremely elongated conveyor assemblies" before
 * changing any viewer code further. No writes — safe to run anytime.
 *
 * Usage: npx ts-node scripts/inspect-assembly-glb-bounds.ts 457185 457243
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { createR2Client, R2_BUCKET } from '../src/modules/files/r2-client';

async function getObjectBytes(r2: ReturnType<typeof createR2Client>, storageKey: string): Promise<Buffer> {
  const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
  const chunks: Buffer[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of object.Body as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const articles = process.argv.slice(2);
  if (articles.length === 0) {
    console.error('Usage: ts-node scripts/inspect-assembly-glb-bounds.ts <article> [article...]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const r2 = createR2Client();
  const io = new NodeIO();

  try {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });

    for (const company of companies) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${company.id}'`);

        const assemblies = await tx.assembly.findMany({
          where: { article: { in: articles }, deletedAt: null },
          select: { id: true, article: true, name: true },
        });
        if (assemblies.length === 0) return;

        for (const asm of assemblies) {
          console.log(`\n=== ${asm.article} — ${asm.name} (${asm.id}, company ${company.name}) ===`);

          const files = await tx.fileAsset.findMany({
            where: { entityType: 'Assembly', entityId: asm.id, domain: 'ASSEMBLY_DOCUMENT', deletedAt: null },
            select: { id: true, originalName: true, storageKey: true, convertedStorageKey: true, conversionStatus: true },
          });
          if (files.length === 0) {
            console.log('  (no ASSEMBLY_DOCUMENT files)');
            continue;
          }

          for (const file of files) {
            const isGlbByName = /\.glb$/i.test(file.originalName);
            const key = file.conversionStatus === 'DONE' && file.convertedStorageKey ? file.convertedStorageKey : isGlbByName ? file.storageKey : null;
            if (!key) {
              console.log(`  ${file.originalName}: not a usable .glb source, skipping`);
              continue;
            }
            try {
              const bytes = await getObjectBytes(r2, key);
              const doc = await io.readBinary(new Uint8Array(bytes));
              const bounds = getBounds(doc.getRoot().listScenes()[0]);
              const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
              const center = [(bounds.max[0] + bounds.min[0]) / 2, (bounds.max[1] + bounds.min[1]) / 2, (bounds.max[2] + bounds.min[2]) / 2];
              console.log(`  ${file.originalName} (${key})`);
              console.log(`    bytes: ${bytes.byteLength}`);
              console.log(`    min: [${bounds.min.map((n) => n.toFixed(3)).join(', ')}]`);
              console.log(`    max: [${bounds.max.map((n) => n.toFixed(3)).join(', ')}]`);
              console.log(`    size (x,y,z): [${size.map((n) => n.toFixed(3)).join(', ')}]`);
              console.log(`    center: [${center.map((n) => n.toFixed(3)).join(', ')}]`);
              const maxDim = Math.max(...size);
              const minDim = Math.min(...size);
              console.log(`    aspect ratio (max/min dimension): ${(maxDim / minDim).toFixed(1)}x`);
            } catch (err) {
              console.log(`  ${file.originalName}: FAILED to read — ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
