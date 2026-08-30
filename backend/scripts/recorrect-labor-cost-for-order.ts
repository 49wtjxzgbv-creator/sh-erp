/**
 * One-off correction (2026-08-31, explicit user request — "я змінив
 * вартість деяких виробів, перерахуй заморожену вартість партій і
 * зарплату відповідно до нових цін", re-run the same day after a second
 * round of price edits): labor-cost freezing at ProductionOrdersService#
 * start() is deliberate (its own header comment) — editing an Assembly's
 * laborCostPerUnit after a batch has already started, and after workers
 * have already been confirmed/paid against it, does NOT retroactively
 * change what's frozen or what was paid. The user explicitly asked for
 * exactly that to be redone, manually, for one order — potentially more
 * than once as prices keep changing, so this must be safely RE-RUNNABLE.
 *
 * For every batch (ProductionOrder) tied to the given order's items
 * (top-level OR sub-assembly, any depth) that is already STARTED
 * (laborCostEur not null) and whose assembly's CURRENT laborCostPerUnit no
 * longer matches unitsPlanned-normalized frozen labor:
 *  1. Re-freezes laborCostEur/totalLocalCostEur/totalGermanCostEur/
 *     fullCostEur on the ProductionOrder — same ownLabor/totalLocalCostEur
 *     formula start() itself uses (materials/packaging/delivery/other stay
 *     untouched, only the labor component moves) — AND ProductionExecution.
 *     totalAmount on every CONFIRMED execution against it, for consistency
 *     (2026-08-31 fix — the first run of this script left totalAmount
 *     stale, which would have double-corrected on any second run; see (2)).
 *  2. For every CONFIRMED execution, recomputes what its totalAmount
 *     SHOULD be at the new rate, and for each of that execution's ORIGINAL
 *     allocations, issues a new correcting PayrollEntry (type PIECEWORK,
 *     unitsProduced: 0 — no new output, purely a price correction) for the
 *     gap between that and what's ACTUALLY been paid so far. "Actually
 *     paid so far" is computed by querying PayrollEntry directly — the
 *     original entry (via sourceAllocationId, still @unique to it) PLUS
 *     every prior correction this same script already issued for this
 *     exact allocation (matched via the allocation id embedded in the
 *     comment — sourceAllocationId itself is left null on correction rows,
 *     same convention ProductionExecutionsService#void_ already uses,
 *     since it's @unique and already claimed by the original entry) —
 *     NEVER by trusting execution.totalAmount as a running balance, which
 *     is exactly the mistake that caused a duplicate correction on the
 *     second run before this fix.
 *
 * Read-only by default (DRY_RUN unless APPLY=1). Scoped to one company AND
 * one order explicitly — never a blind company-wide rate reconciliation;
 * this is a one-time, explicitly-requested exception to the frozen-cost
 * rule, not a new standing behavior or a general-purpose tool.
 *
 * Usage: APPLY=1 npx ts-node scripts/recorrect-labor-cost-for-order.ts <companyId> <orderNumber>
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const [companyId, orderNumber] = process.argv.slice(2);
const APPLY = process.env.APPLY === '1';

if (!companyId || !orderNumber) {
  console.error('Usage: APPLY=1 npx ts-node scripts/recorrect-labor-cost-for-order.ts <companyId> <orderNumber>');
  process.exit(1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function run(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);

    const order = await tx.customerOrder.findFirst({ where: { orderNumber }, include: { items: true } });
    if (!order) throw new Error(`No customer order with orderNumber=${orderNumber} in company ${companyId}`);
    const itemIds = order.items.map((i) => i.id);

    const batches = await tx.productionOrder.findMany({
      where: {
        OR: [{ customerOrderItemId: { in: itemIds } }, { subAssemblyForItemId: { in: itemIds } }],
        laborCostEur: { not: null },
      },
    });
    console.log(`[order ${orderNumber}] ${batches.length} started batch(es) to check`);

    let totalCorrectionAmount = 0;
    let correctionRows = 0;

    for (const batch of batches) {
      const assembly = await tx.assembly.findUnique({ where: { id: batch.assemblyId } });
      if (!assembly) continue;

      const unitsPlanned = Number(batch.unitsPlanned);
      const oldLabor = Number(batch.laborCostEur ?? 0);
      const newLabor = round2(Number(assembly.laborCostPerUnit) * unitsPlanned);
      if (Math.abs(newLabor - oldLabor) < 0.005) continue; // rate unchanged for this batch

      const laborDelta = newLabor - oldLabor;
      console.log(
        `  batch ${batch.id} (${assembly.article ?? assembly.name}): frozen ${oldLabor.toFixed(2)} -> ${newLabor.toFixed(2)} (unitsPlanned ${unitsPlanned}, rate now ${assembly.laborCostPerUnit})`,
      );

      const newTotalLocalCostEur = round2(Number(batch.totalLocalCostEur ?? 0) + laborDelta);
      const newTotalGermanCostEur = round2(Number(batch.totalGermanCostEur ?? 0) + laborDelta);
      if (APPLY) {
        await tx.productionOrder.update({
          where: { id: batch.id },
          data: {
            laborCostEur: newLabor,
            totalLocalCostEur: newTotalLocalCostEur,
            totalGermanCostEur: newTotalGermanCostEur,
            fullCostEur: newTotalLocalCostEur,
          },
        });
      }

      const executions = await tx.productionExecution.findMany({
        where: { productionOrderId: batch.id, status: 'CONFIRMED' },
        include: { allocations: true },
      });

      for (const execution of executions) {
        // originalExecTotal (the value execution.totalAmount held when it
        // was first confirmed) is used ONLY to derive each allocation's
        // fixed split ratio (percent/hours never change with the rate) —
        // never as a "how much is already paid" balance, which is what the
        // pre-fix version got wrong on a second run.
        const originalExecTotal = Number(execution.totalAmount);
        const qtyCompleted = Number(execution.qtyCompleted ?? 0);
        const newExecTotal = round2(unitsPlanned > 0 ? (qtyCompleted / unitsPlanned) * newLabor : 0);

        for (const allocation of execution.allocations) {
          const shareFraction = originalExecTotal !== 0 ? Number(allocation.amount) / originalExecTotal : 1 / execution.allocations.length;
          const correctAllocationTotal = round2(newExecTotal * shareFraction);

          const [originalEntry, priorCorrections] = await Promise.all([
            tx.payrollEntry.findUnique({ where: { sourceAllocationId: allocation.id } }),
            tx.payrollEntry.findMany({
              where: { productionOrderId: batch.id, sourceAllocationId: null, comment: { contains: allocation.id } },
            }),
          ]);
          const alreadyPaid = Number(originalEntry?.amount ?? 0) + priorCorrections.reduce((sum, e) => sum + Number(e.amount), 0);

          const correction = round2(correctAllocationTotal - alreadyPaid);
          if (Math.abs(correction) < 0.005) continue;

          console.log(
            `    execution ${execution.id}, employee ${allocation.employeeId}: ${APPLY ? 'creating' : 'would create'} correction €${correction.toFixed(2)} (already paid €${alreadyPaid.toFixed(2)}, correct total €${correctAllocationTotal.toFixed(2)})`,
          );
          if (APPLY) {
            await tx.payrollEntry.create({
              data: {
                companyId,
                employeeId: allocation.employeeId,
                type: 'PIECEWORK',
                productionOrderId: batch.id,
                unitsProduced: 0,
                amount: correction,
                comment: `Коригування ставки праці для ${assembly.article ?? assembly.name} (замовлення ${orderNumber}) до ${assembly.laborCostPerUnit}€/од. Оригінальне виконання ${execution.id}, розподіл ${allocation.id}.`,
                createdById: execution.confirmedById ?? execution.recordedById,
              } as any,
            });
          }
          totalCorrectionAmount += correction;
          correctionRows += 1;
        }

        if (APPLY && Math.abs(newExecTotal - originalExecTotal) >= 0.005) {
          await tx.productionExecution.update({ where: { id: execution.id }, data: { totalAmount: newExecTotal } });
        }
      }
    }

    console.log(`[order ${orderNumber}] total ${APPLY ? 'created' : 'would create'}: ${correctionRows} correction row(s), €${round2(totalCorrectionAmount).toFixed(2)}`);

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
    await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main();
