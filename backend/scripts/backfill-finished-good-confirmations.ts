/**
 * One-off backfill (2026-08-30, extended 2026-08-31): FinishedGood.
 * confirmedByExecutionId only gets stamped going forward, by
 * ProductionExecutionsService#confirm(). Two separate gaps this replays:
 *  - Any ProductionExecution CONFIRMED before this column existed never
 *    touched it (2026-08-30).
 *  - Any execution confirmed AFTER a sub-assembly's units were already
 *    CONSUMED by their parent's own start() — stampConfirmedFinishedGoods
 *    used to only match `status: 'IN_STOCK'` candidates, so a unit consumed
 *    before its own confirm() ran was skipped and never got stamped, even
 *    by live confirms (2026-08-31 fix, matching that method's own status-
 *    agnostic candidate query now).
 * This replays the exact same FIFO-match confirm() now does, against every
 * historical CONFIRMED execution, in the order they were actually confirmed
 * (confirmedAt asc) — so a batch confirmed in two separate executions gets
 * its units split the same way live confirms would have split them.
 *
 * Idempotent — only ever writes rows where confirmedByExecutionId IS NULL
 * (findMany's own where clause), so re-running is always safe and a mix of
 * old (backfilled) and new (live-stamped) confirmations never double-counts.
 *
 * Read-only by default (DRY_RUN unless APPLY=1). RLS-protected tables need
 * `app.current_company_id` set first — same SET LOCAL-inside-one-transaction
 * pattern as reconcile-reserved-qty.ts, scoped per company explicitly
 * rather than a blind cross-tenant query.
 *
 * Usage: APPLY=1 npx ts-node scripts/backfill-finished-good-confirmations.ts <companyId> [<companyId>...]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const COMPANY_IDS = process.argv.slice(2);
const APPLY = process.env.APPLY === '1';

if (COMPANY_IDS.length === 0) {
  console.error('Usage: APPLY=1 npx ts-node scripts/backfill-finished-good-confirmations.ts <companyId> [<companyId>...]');
  process.exit(1);
}

async function backfillCompany(prisma: PrismaClient, companyId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);

    const executions = await tx.productionExecution.findMany({
      where: { status: 'CONFIRMED', productionOrderId: { not: null } },
      orderBy: { confirmedAt: 'asc' },
    });
    console.log(`[${companyId}] ${executions.length} CONFIRMED PRODUCT execution(s) to check`);

    let totalStamped = 0;
    for (const execution of executions) {
      const qty = Math.floor(Number(execution.qtyCompleted ?? 0));
      if (qty <= 0) continue;

      const candidates = await tx.finishedGood.findMany({
        where: { productionOrderId: execution.productionOrderId!, confirmedByExecutionId: null },
        orderBy: { manufactureDate: 'asc' },
        take: qty,
      });
      if (candidates.length === 0) continue;

      console.log(`  execution ${execution.id} (order ${execution.productionOrderId}, confirmed ${execution.confirmedAt?.toISOString()}): ${APPLY ? 'stamping' : 'would stamp'} ${candidates.length} unit(s)`);
      if (APPLY) {
        await tx.finishedGood.updateMany({
          where: { id: { in: candidates.map((c) => c.id) } },
          data: { confirmedByExecutionId: execution.id },
        });
      }
      totalStamped += candidates.length;
    }
    console.log(`[${companyId}] total ${APPLY ? 'stamped' : 'would stamp'}: ${totalStamped}`);

    if (!APPLY) {
      // Roll back — DRY_RUN must never persist anything, even the SET LOCAL.
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
      await backfillCompany(prisma, companyId);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
