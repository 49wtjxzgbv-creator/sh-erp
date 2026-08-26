import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const COMPANY_ID = process.argv[2];
const ARTICLES = process.argv.slice(3);

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${COMPANY_ID}'`);
      for (const article of ARTICLES) {
        const a = await tx.assembly.findFirst({ where: { companyId: COMPANY_ID, article }, select: { id: true, article: true, name: true, defaultSupplierId: true } });
        if (!a) {
          console.log(`${article}: NOT FOUND as an assembly`);
          continue;
        }
        const links = await tx.assemblySupplier.findMany({ where: { companyId: COMPANY_ID, assemblyId: a.id }, include: { supplier: { select: { name: true } } } });
        console.log(`${a.article} — ${a.name}: defaultSupplierId=${a.defaultSupplierId ?? 'null'}, assemblySupplier links=${links.length}${links.map((l) => ` [${l.supplier.name}]`).join('')}`);
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
