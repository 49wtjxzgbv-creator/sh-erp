/**
 * One-off correction (2026-08-31, explicit user request — "я змінив
 * вартість деяких виробів, перерахуй заморожену вартість партій і
 * зарплату відповідно до нових цін"): labor-cost freezing at
 * ProductionOrdersService#start() is deliberate (its own header comment)
 * — editing an Assembly's laborCostPerUnit after a batch has already
 * started, and after workers have already been confirmed/paid against it,
 * does NOT retroactively change what's frozen or what was paid. The user
 * explicitly asked for exactly that to be redone, once, for one order.
 *
 * For every batch (ProductionOrder) tied to the given order's items
 * (top-level OR sub-assembly, any depth) that is already STARTED
 * (laborCostEur not null) and whose assembly's CURRENT laborCostPerUnit no
 * longer matches unitsPlanned-normalized frozen labor:
 *  1. Re-freezes laborCostEur/totalLocalCostEur/totalGermanCostEur/
 *     fullCostEur on the ProductionOrder — same ownLabor/totalLocalCostEur
 *     formula start() itself uses (materials/packaging/delivery/other stay
 *     untouched, only the labor component moves).
 *  2. For every CONFIRMED execution against that batch, recomputes what
 *     its totalAmount would be at the new rate (same qtyCompleted/
 *     unitsPlanned x laborCostEur formula computeAndValidateProductAmount
 *     uses) and, for each of that execution's ORIGINAL allocations, issues
 *     a new correcting PayrollEntry (type PIECEWORK, unitsProduced: 0 — no
 *     new output, purely a price correction on already-produced units) for
 *     that allocation's same proportional share of the delta (new - old).
 *     sourceAllocationId is left null — it's @unique and already claimed by
 *     the original entry, same convention ProductionExecutionsService#void_
 *     already uses — the comment carries the traceback instead.
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
        const qtyCompleted = Number(execution.qtyCompleted ?? 0);
        const oldExecTotal = Number(execution.totalAmount);
        const newExecTotal = round2(unitsPlanned > 0 ? (qtyCompleted / unitsPlanned) * newLabor : 0);
        const execDelta = newExecTotal - oldExecTotal;
        if (Math.abs(execDelta) < 0.005) continue;

        for (const allocation of execution.allocations) {
          const share = oldExecTotal !== 0 ? Number(allocation.amount) / oldExecTotal : 1 / execution.allocations.length;
          const correction = round2(execDelta * share);
          if (Math.abs(correction) < 0.005) continue;

          console.log(
            `    execution ${execution.id}, employee ${allocation.employeeId}: ${APPLY ? 'creating' : 'would create'} correction €${correction.toFixed(2)}`,
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
                comment: `Коригування ставки праці для ${assembly.article ?? assembly.name} (замовлення ${orderNumber}): ${round2(oldLabor / unitsPlanned).toFixed(2)}€ → ${assembly.laborCostPerUnit}€/од. Оригінальне виконання ${execution.id}, розподіл ${allocation.id}.`,
                createdById: execution.confirmedById ?? execution.recordedById,
              } as any,
            });
          }
          totalCorrectionAmount += correction;
          correctionRows += 1;
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
