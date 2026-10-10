/**
 * "ціль щоб з телефона також відкривалось" (2026-10-09): GlbOptimizationService
 * (see its own header comment for the full "why" — GPU-instancing a real
 * CAD-export .glb's repeated-mesh nodes, confirmed to fix a real mobile
 * crash on a 34,257-node file) only runs on FUTURE uploads
 * (FilesService#confirmUpload). This one-off backfill applies it to every
 * already-uploaded directly-.glb FileAsset — like the two real files
 * (440158.glb, 447873.glb) this feature was built for — that predate the
 * feature and would otherwise never get optimized on their own.
 *
 * Reuses GlbOptimizationService's own `optimize()` as-is (not a
 * reimplementation kept "in lockstep" like some other scripts in this
 * directory) — its only dependency is a plain PrismaClient with
 * `.$transaction`/`.fileAsset` (see that service's own header comment on
 * why it never goes through the tenant-scoped `prisma.tenant.*` proxy),
 * so it runs here with zero NestJS bootstrap.
 *
 * Run against the SUPERUSER connection (MIGRATION_DATABASE_URL in
 * /etc/sh-erp/backend.env on the VPS, same one `prisma migrate deploy`
 * uses) — the SELECT below deliberately spans every company, which
 * file_assets' own RLS policy would otherwise block for any single
 * tenant-scoped connection.
 *
 * DRY_RUN by default (just lists candidates); APPLY=1 actually optimizes.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GlbOptimizationService } from '../src/modules/files/glb-optimization.service';

const APPLY = process.env.APPLY === '1';
const GLB_EXTENSION = /\.glb$/i;
// Same number as GlbOptimizationService's own MOBILE_SIMPLIFY_THRESHOLD_BYTES — duplicated rather than imported, same "small constant, not worth a shared module for one script" reasoning as elsewhere in this codebase.
const MOBILE_SIMPLIFY_THRESHOLD_BYTES = 70 * 1024 * 1024;

async function main() {
  const prisma = new PrismaClient();
  const glbOptimization = new GlbOptimizationService(prisma as any);
  try {
    // "додатково спростити геометрію для файлів більше 70 мб" (2026-10-09):
    // also re-visits a file whose desktop pass already finished (DONE)
    // but is big enough to need a mobile variant it never got — real
    // case: 447873.glb was optimized before this threshold/field existed.
    // "показується не весь виріб а по одній деталі" (2026-10-10): same
    // re-visit logic for the new AR (de-instanced) variant — every
    // already-optimized file predates `arOptimizationStatus` and would
    // otherwise never get one. `glbOptimization.optimize()` is idempotent
    // (always rebuilds every output from the original), so re-running it
    // here is safe even for files that already have other variants done.
    const candidates = await prisma.fileAsset.findMany({
      where: {
        originalName: { endsWith: '.glb', mode: 'insensitive' },
        deletedAt: null,
        OR: [
          { optimizationStatus: 'NONE' },
          { sizeBytes: { gt: MOBILE_SIMPLIFY_THRESHOLD_BYTES }, mobileOptimizationStatus: 'NONE' },
          { arOptimizationStatus: 'NONE' },
        ],
      },
    });

    console.log(`Found ${candidates.length} .glb file(s) needing (re-)optimization.`);
    for (const file of candidates) {
      if (!GLB_EXTENSION.test(file.originalName)) continue; // belt-and-suspenders against a case Prisma's `endsWith` matched oddly
      console.log(`  ${file.originalName} (${file.id}, company ${file.companyId}, ${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB)`);
      if (APPLY) {
        await glbOptimization.optimize(file);
        const updated = await prisma.fileAsset.findUnique({ where: { id: file.id } });
        console.log(
          `    -> optimizationStatus=${updated?.optimizationStatus} mobileOptimizationStatus=${updated?.mobileOptimizationStatus} arOptimizationStatus=${updated?.arOptimizationStatus}`,
        );
      }
    }
    if (!APPLY) console.log('DRY RUN — re-run with APPLY=1 to actually optimize.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
