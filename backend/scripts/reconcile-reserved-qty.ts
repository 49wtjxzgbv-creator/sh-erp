/**
 * One-off reconciliation for the reservedQty drift found live on company
 * 131313, order №440172, article 409222 (2026-08-26): WarehouseStock.
 * reservedQty is a denormalized running total that's supposed to always
 * equal SUM(StockReservation.qty) for that (company, product, warehouse) —
 * see WarehouseStock.reservedQty's own schema comment. grantReservation()
 * (stock-reservation.service.ts) incremented that counter and upserted the
 * StockReservation row as two SEPARATE, non-transactional statements; a
 * partial failure between them (now fixed, see the accompanying code
 * change) could leave the counter higher than any reservation actually on
 * record — a "phantom" hold that makes stock look unavailable for no real
 * order.
 *
 * Read-only by default (DRY_RUN=1 or no arg prints the diff and touches
 * nothing). Pass APPLY=1 to actually correct drifted rows. Scoped to a
 * single companyId, since that's the only place this was observed and a
 * blind company-wide pass wasn't asked for.
 */
import 'dotenv/config'; // standalone script, not booted through Nest's ConfigModule — load .env the same way it does
import { PrismaClient, Prisma } from '@prisma/client';

const COMPANY_ID = process.argv[2];
const APPLY = process.env.APPLY === '1';

if (!COMPANY_ID) {
  console.error('Usage: APPLY=1 npx ts-node scripts/reconcile-reserved-qty.ts <companyId>');
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // warehouse_stock/stock_reservations/products are all RLS-protected
    // (ADR-0002) — fail closed with zero rows unless `app.current_company_id`
    // is set first, inside the SAME transaction (SET LOCAL is transaction-
    // scoped). A plain PrismaClient call outside a request has nothing to
    // set that, hence this explicit transaction, mirroring what
    // PrismaService#runInTenantTransaction does per-request in the app itself.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${COMPANY_ID}'`);

      const stocks = await tx.warehouseStock.findMany({
        where: { companyId: COMPANY_ID },
        select: { id: true, productId: true, warehouseId: true, qty: true, reservedQty: true },
      });

      const sums = await tx.stockReservation.groupBy({
        by: ['productId', 'warehouseId'],
        where: { companyId: COMPANY_ID },
        _sum: { qty: true },
      });
      const sumByKey = new Map(sums.map((s) => [`${s.productId}:${s.warehouseId}`, Number(s._sum.qty ?? 0)]));

      const products = await tx.product.findMany({ where: { companyId: COMPANY_ID }, select: { id: true, article: true } });
      const articleById = new Map(products.map((p) => [p.id, p.article]));

      const drifted = stocks
        .map((s) => {
          const trueReserved = sumByKey.get(`${s.productId}:${s.warehouseId}`) ?? 0;
          const currentReserved = Number(s.reservedQty);
          return { ...s, trueReserved, currentReserved, drift: currentReserved - trueReserved };
        })
        .filter((s) => s.drift !== 0);

      console.log(`Company ${COMPANY_ID}: ${stocks.length} warehouse_stock rows checked, ${drifted.length} drifted.`);
      for (const d of drifted) {
        console.log(
          `  article=${articleById.get(d.productId) ?? d.productId} warehouseId=${d.warehouseId} ` +
            `qty=${d.qty} reservedQty(stored)=${d.currentReserved} reservedQty(true)=${d.trueReserved} drift=${d.drift}`,
        );
      }

      if (!APPLY) {
        console.log('\nDRY RUN — no changes written. Re-run with APPLY=1 to correct the rows above.');
        return;
      }

      for (const d of drifted) {
        await tx.warehouseStock.update({
          where: { id: d.id },
          data: { reservedQty: new Prisma.Decimal(d.trueReserved) },
        });
      }
      console.log(`\nApplied: corrected ${drifted.length} row(s).`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
