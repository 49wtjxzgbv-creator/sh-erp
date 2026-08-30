/**
 * One-off correction (2026-08-31): backfill-finished-good-confirmations.ts
 * was applied twice against production (2026-08-30 and 2026-08-31) before
 * it was made idempotent (see that script's own updated header). Each run
 * independently found "still-unstamped" FinishedGood candidates for every
 * historical CONFIRMED execution and stamped up to floor(qtyCompleted) of
 * them under that execution's id — with no memory of what a prior run had
 * already stamped for that same execution. For any batch with enough spare
 * IN_STOCK inventory beyond what was actually confirmed, the second run
 * found a fresh set of candidates and stamped them too, doubling the
 * confirmed count for that batch (discovered live: order 441639's article
 * 279785 read as 46 confirmed when only 23 units were ever actually paid
 * for, per the real PayrollEntry ledger).
 *
 * Recomputes the correct target per ProductionOrder — sum(floor(
 * qtyCompleted)) across its own CONFIRMED executions — and un-stamps
 * whatever's stamped beyond that target. Which specific serials get
 * un-stamped doesn't matter (same "units are interchangeable within a
 * batch" convention this whole confirmation-stamping feature already
 * relies on — see stampConfirmedFinishedGoods's own header); most-recently-
 * manufactured units are un-stamped first, purely for a deterministic
 * result across repeated dry runs.
 *
 * Read-only by default (DRY_RUN unless APPLY=1). RLS-protected tables need
 * `app.current_company_id` set first — same SET LOCAL-inside-one-transaction
 * pattern as reconcile-reserved-qty.ts, scoped per company explicitly
 * rather than a blind cross-tenant query.
 *
 * Usage: APPLY=1 npx ts-node scripts/fix-duplicate-finished-good-confirmations.ts <companyId> [<companyId>...]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const COMPANY_IDS = process.argv.slice(2);
const APPLY = process.env.APPLY === '1';

if (COMPANY_IDS.length === 0) {
  console.error('Usage: APPLY=1 npx ts-node scripts/fix-duplicate-finished-good-confirmations.ts <companyId> [<companyId>...]');
  process.exit(1);
}

async function fixCompany(prisma: PrismaClient, companyId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);

    const stampedGoods = await tx.finishedGood.findMany({
      where: { confirmedByExecutionId: { not: null } },
      select: { productionOrderId: true },
    });
    const batchIds = Array.from(new Set(stampedGoods.map((g) => g.productionOrderId).filter((id): id is string => Boolean(id))));
    console.log(`[${companyId}] ${batchIds.length} batch(es) with confirmed units to check`);

    let totalUnstamped = 0;
    for (const productionOrderId of batchIds) {
      const [executions, stampedCount] = await Promise.all([
        tx.productionExecution.findMany({ where: { status: 'CONFIRMED', productionOrderId } }),
        tx.finishedGood.count({ where: { productionOrderId, confirmedByExecutionId: { not: null } } }),
      ]);
      const target = executions.reduce((sum, e) => sum + Math.floor(Number(e.qtyCompleted ?? 0)), 0);
      const excess = stampedCount - target;
      if (excess <= 0) continue;

      const toUnstamp = await tx.finishedGood.findMany({
        where: { productionOrderId, confirmedByExecutionId: { not: null } },
        orderBy: { manufactureDate: 'desc' },
        take: excess,
      });

      console.log(`  batch ${productionOrderId}: stamped ${stampedCount}, should be ${target} — ${APPLY ? 'un-stamping' : 'would un-stamp'} ${toUnstamp.length}`);
      if (APPLY) {
        await tx.finishedGood.updateMany({
          where: { id: { in: toUnstamp.map((g) => g.id) } },
          data: { confirmedByExecutionId: null },
        });
      }
      totalUnstamped += toUnstamp.length;
    }
    console.log(`[${companyId}] total ${APPLY ? 'un-stamped' : 'would un-stamp'}: ${totalUnstamped}`);

    if (!APPLY) {
      throw new Error('DRY_RUN_ROLLBACK');
    }
  }).catch((err) => {
    if (err.message !== 'DRY_RUN_ROLLBACK') throw err;
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const companyId of COMPANY_IDS) {
      await fixCompany(prisma, companyId);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
