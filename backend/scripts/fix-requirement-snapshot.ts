/**
 * One-off correction for OrderMaterialRequirement.requiredQty rows that
 * were locked in BEFORE the FinishedGood-offset fix to walkAssembly
 * (customer-order-shortage.service.ts, 2026-08-26) — requiredQty is a
 * snapshot taken once and never recomputed, so existing rows kept the old,
 * inflated pre-fix number even after the calculation itself was fixed.
 * Confirmed against the live, already-fixed app before running this:
 *   order 440172, product 249662: true requiredQty is now 11736 (was 31296)
 *   order 441639, product 249662: true requiredQty is now 0 (was 19560)
 * Only updates requiredQty and qtyToPurchase (= max(requiredQty -
 * qtyFromStock, 0)) — never touches qtyFromStock/StockReservation here;
 * releasing the resulting excess reservation is a separate, explicit step
 * via the normal "Забронювати зі складу" flow so it goes through
 * StockReservationService#release properly (WarehouseStock.reservedQty and
 * the StockReservation row decremented together, audited).
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const COMPANY_ID = process.argv[2];

const CORRECTIONS: { orderNumber: string; article: string; trueRequiredQty: number }[] = [
  { orderNumber: '440172', article: '249662', trueRequiredQty: 11736 },
  { orderNumber: '441639', article: '249662', trueRequiredQty: 0 },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${COMPANY_ID}'`);

      for (const c of CORRECTIONS) {
        const order = await tx.customerOrder.findFirst({ where: { companyId: COMPANY_ID, orderNumber: c.orderNumber } });
        const product = await tx.product.findFirst({ where: { companyId: COMPANY_ID, article: c.article } });
        if (!order || !product) {
          console.log(`SKIP ${c.orderNumber}/${c.article}: order or product not found`);
          continue;
        }
        const req = await tx.orderMaterialRequirement.findUnique({
          where: { customerOrderId_productId: { customerOrderId: order.id, productId: product.id } },
        });
        if (!req) {
          console.log(`SKIP ${c.orderNumber}/${c.article}: no requirement row exists`);
          continue;
        }
        const qtyFromStock = Number(req.qtyFromStock);
        const newQtyToPurchase = Math.max(c.trueRequiredQty - qtyFromStock, 0);
        console.log(
          `${c.orderNumber}/${c.article}: requiredQty ${req.requiredQty} -> ${c.trueRequiredQty}, ` +
            `qtyToPurchase ${req.qtyToPurchase} -> ${newQtyToPurchase} (qtyFromStock unchanged at ${qtyFromStock})`,
        );
        await tx.orderMaterialRequirement.update({
          where: { id: req.id },
          data: { requiredQty: new Prisma.Decimal(c.trueRequiredQty), qtyToPurchase: new Prisma.Decimal(newQtyToPurchase) },
        });
      }
    });
    console.log('\nDone.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
