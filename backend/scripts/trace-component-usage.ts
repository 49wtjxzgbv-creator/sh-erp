/**
 * Read-only trace: for a given product article, find every assembly (and
 * nested sub-assembly) that uses it, at what qtyPerUnit, and recompute the
 * gross requirement for each of company 131313's two active orders exactly
 * the way CustomerOrderShortageService#buildPools does (a recursive walk,
 * stopping at any sub-assembly that has a defaultSupplierId or a supplier
 * link — those are bought whole, not broken down further). Built to answer
 * a live "why does it say X, shouldn't it be Y?" question (2026-08-26,
 * articles 276199 and 249662) without guessing through the UI.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const COMPANY_ID = process.argv[2];
const ARTICLE = process.argv[3];

if (!COMPANY_ID || !ARTICLE) {
  console.error('Usage: npx ts-node scripts/trace-component-usage.ts <companyId> <article>');
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${COMPANY_ID}'`);

      const product = await tx.product.findFirst({ where: { companyId: COMPANY_ID, article: ARTICLE } });
      if (!product) {
        console.log(`No product with article ${ARTICLE} found.`);
        return;
      }
      console.log(`Product: ${product.article} — ${product.name} (id=${product.id})`);
      const productId = product.id;

      // Direct usages: every assemblyComponent row pointing straight at this product.
      const directUses = await tx.assemblyComponent.findMany({
        where: { companyId: COMPANY_ID, componentType: 'PRODUCT', productId: product.id },
        include: { assembly: { select: { id: true, article: true, name: true } } },
      });
      console.log(`\nDirect BOM usages (${directUses.length}):`);
      for (const u of directUses) {
        console.log(`  in "${u.assembly.article} — ${u.assembly.name}": qtyPerUnit=${u.qtyPerUnit}`);
      }

      // Now walk both active orders' item trees exactly like buildPools does,
      // logging every path that terminates in this product.
      const orders = await tx.customerOrder.findMany({
        where: { companyId: COMPANY_ID, status: { in: ['NEW', 'IN_PRODUCTION'] } },
        include: { items: true },
      });

      const assemblyCache = new Map<string, { id: string; article: string; name: string; defaultSupplierId: string | null }>();
      async function getAssembly(id: string) {
        if (!assemblyCache.has(id)) {
          const a = await tx.assembly.findUnique({ where: { id }, select: { id: true, article: true, name: true, defaultSupplierId: true } });
          assemblyCache.set(id, a as any);
        }
        return assemblyCache.get(id)!;
      }

      async function walk(assemblyId: string, qtyMultiplier: number, path: string[], out: { path: string; qty: number }[]) {
        const components = await tx.assemblyComponent.findMany({ where: { companyId: COMPANY_ID, assemblyId } });
        for (const c of components) {
          const perUnit = Number(c.qtyPerUnit);
          const totalQty = perUnit * qtyMultiplier;
          if (c.componentType === 'PRODUCT' && c.productId === productId) {
            out.push({ path: [...path, `${perUnit}/unit`].join(' -> '), qty: totalQty });
          } else if (c.componentType === 'ASSEMBLY' && c.subAssemblyId) {
            const sub = await getAssembly(c.subAssemblyId);
            const hasSupplierLink =
              Boolean(sub.defaultSupplierId) || (await tx.assemblySupplier.count({ where: { companyId: COMPANY_ID, assemblyId: sub.id } })) > 0;
            if (!hasSupplierLink) {
              await walk(sub.id, totalQty, [...path, `${sub.article}(${sub.name}) x${perUnit}`], out);
            }
            // if it DOES have a supplier link, buildPools treats it as a bought
            // whole sub-assembly and stops — this product wouldn't be
            // separately counted for THAT branch.
          }
        }
      }

      for (const order of orders) {
        console.log(`\n=== Order ${order.orderNumber ?? order.id} (status=${order.status}) ===`);
        let total = 0;
        for (const item of order.items) {
          const assembly = await getAssembly(item.assemblyId);
          const out: { path: string; qty: number }[] = [];
          await walk(assembly.id, Number(item.qty), [`item: ${assembly.article}(${assembly.name}) x${item.qty}`], out);
          for (const o of out) {
            console.log(`  ${o.path} = ${o.qty}`);
            total += o.qty;
          }
        }
        console.log(`  TOTAL for this order: ${total}`);
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
