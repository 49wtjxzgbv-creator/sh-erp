/**
 * One-off release for a StockReservation the UI has no path to touch
 * anymore: the "Забронювати зі складу" button only ever submits decisions
 * for products still present in the LIVE shortage pool, but this order's
 * true need for this product just dropped to zero (FinishedGood-offset
 * fix, 2026-08-26) — the line simply no longer renders, yet the old
 * StockReservation(source=STOCK) row is still holding physical stock.
 * Mirrors StockReservationService#release exactly (paired, same
 * transaction): decrement warehouse_stock.reservedQty, decrement the
 * stock_reservations row, and bring OrderMaterialRequirement.qtyFromStock
 * down to match — so nothing here can drift the way the original bug did.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const COMPANY_ID = process.argv[2];
const ORDER_NUMBER = process.argv[3];
const ARTICLE = process.argv[4];
const TARGET_QTY = Number(process.argv[5]); // the new, correct qtyFromStock to leave in place

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${COMPANY_ID}'`);

      const order = await tx.customerOrder.findFirst({ where: { companyId: COMPANY_ID, orderNumber: ORDER_NUMBER } });
      const product = await tx.product.findFirst({ where: { companyId: COMPANY_ID, article: ARTICLE } });
      if (!order || !product) throw new Error('order or product not found');

      const reservation = await tx.stockReservation.findUnique({
        where: { customerOrderId_productId_warehouseId_source: { customerOrderId: order.id, productId: product.id, warehouseId: (await tx.warehouse.findFirstOrThrow({ where: { companyId: COMPANY_ID, isDefault: true } })).id, source: 'STOCK' } },
      });
      if (!reservation) throw new Error('no STOCK reservation row found');

      const currentQty = Number(reservation.qty);
      const releaseQty = currentQty - TARGET_QTY;
      if (releaseQty <= 0) {
        console.log(`Nothing to release — current=${currentQty}, target=${TARGET_QTY}.`);
        return;
      }

      await tx.$executeRawUnsafe(
        `UPDATE warehouse_stock SET "reservedQty" = GREATEST("reservedQty" - ${releaseQty}::decimal(14,3), 0), "updatedAt" = now() WHERE "companyId" = '${COMPANY_ID}'::uuid AND "productId" = '${product.id}'::uuid AND "warehouseId" = '${reservation.warehouseId}'::uuid`,
      );
      await tx.stockReservation.update({ where: { id: reservation.id }, data: { qty: { decrement: releaseQty }, releasedQty: { increment: releaseQty } } });

      const req = await tx.orderMaterialRequirement.findUnique({ where: { customerOrderId_productId: { customerOrderId: order.id, productId: product.id } } });
      if (req) {
        await tx.orderMaterialRequirement.update({ where: { id: req.id }, data: { qtyFromStock: new Prisma.Decimal(TARGET_QTY) } });
      }

      console.log(`Released ${releaseQty} from order ${ORDER_NUMBER}/${ARTICLE} (STOCK reservation ${currentQty} -> ${TARGET_QTY}).`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
