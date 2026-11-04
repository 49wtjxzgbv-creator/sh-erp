-- "сформувати пдф файл щоб скидати постачальнику" (2026-11-04) — PurchaseOrder
-- gets a real document number (it never had one, unlike PurchaseRequest's
-- "ЗП-..."/Quotation's "КП-...") plus a generated PDF, same Playwright-render
-- + FileAsset mechanism as those two — see PurchaseOrder.number/pdfFileId's
-- own schema.prisma comments.
--
-- Existing rows are backfilled with a per-(company, year-of-createdAt)
-- sequential number, oldest row first ("ЗАМ-2026-0001", ...), then
-- company_document_counters is seeded to the count already assigned per
-- (company, year) so the next number PurchaseOrdersService generates
-- continues the sequence instead of restarting at 1 and colliding.

-- AlterEnum
ALTER TYPE "FileDomain" ADD VALUE 'PURCHASE_ORDER_DOCUMENT';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN "number" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "pdfFileId" UUID;

-- Backfill
WITH numbered AS (
  SELECT id,
         "companyId",
         EXTRACT(YEAR FROM "createdAt")::int AS yr,
         ROW_NUMBER() OVER (PARTITION BY "companyId", EXTRACT(YEAR FROM "createdAt") ORDER BY "createdAt") AS seq
  FROM "purchase_orders"
)
UPDATE "purchase_orders" po
SET "number" = 'ЗАМ-' || numbered.yr || '-' || LPAD(numbered.seq::text, 4, '0')
FROM numbered
WHERE po.id = numbered.id;

INSERT INTO "company_document_counters" ("companyId", "counterKey", "lastValue", "updatedAt")
SELECT "companyId", 'PURCHASE_ORDER_' || EXTRACT(YEAR FROM "createdAt")::int, COUNT(*), now()
FROM "purchase_orders"
GROUP BY "companyId", EXTRACT(YEAR FROM "createdAt")::int
ON CONFLICT ("companyId", "counterKey") DO UPDATE
  SET "lastValue" = GREATEST("company_document_counters"."lastValue", EXCLUDED."lastValue"), "updatedAt" = now();

ALTER TABLE "purchase_orders" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_number_key" UNIQUE ("companyId", "number");
