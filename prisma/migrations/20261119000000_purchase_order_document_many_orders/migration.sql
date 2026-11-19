-- "якщо постачальник призначив декільком замовленням один рахунок на
-- оплату" (2026-11-19) — purchase_order_documents.purchaseOrderId was a
-- single nullable FK (added 2026-08-24, made nullable 2026-11-06 — see
-- that migration's own header comment: "рахунок не обов'язково може
-- бути прив'язаний до замовлення"). A real supplier routinely invoices
-- several orders on ONE combined invoice, which a single FK column can
-- never represent. Replaces it with a proper many-to-many join table,
-- same shape as every other join table in this schema (e.g.
-- product_suppliers): migrates existing linked rows into the join table
-- FIRST, then drops the old column — no data loss for any existing
-- single-order link.
--
-- Design confirmed in chat (2026-11-19): a document linked to MORE than
-- one order is EXCLUDED from each of those orders' own
-- totalDocuments/unpaidPerDocuments sum in FinanceService#buildSummary —
-- enforced in application code (this migration only adds the join table
-- itself) — while still showing up in that order's own document
-- list/count for reference. A document linked to 0 or 1 orders behaves
-- exactly as before.

-- CreateTable
CREATE TABLE "purchase_order_document_orders" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"       UUID NOT NULL,
    "documentId"      UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_document_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_document_orders_documentId_purchaseOrderId_key" ON "purchase_order_document_orders"("documentId", "purchaseOrderId");
CREATE INDEX "purchase_order_document_orders_companyId_idx" ON "purchase_order_document_orders"("companyId");
CREATE INDEX "purchase_order_document_orders_purchaseOrderId_idx" ON "purchase_order_document_orders"("purchaseOrderId");

ALTER TABLE "purchase_order_document_orders" ADD CONSTRAINT "purchase_order_document_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_document_orders" ADD CONSTRAINT "purchase_order_document_orders_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "purchase_order_documents"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_document_orders" ADD CONSTRAINT "purchase_order_document_orders_companyId_purchaseOrderId_fkey" FOREIGN KEY ("companyId", "purchaseOrderId") REFERENCES "purchase_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE purchase_order_document_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_document_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_document_orders
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- Migrate existing single-order links into the join table BEFORE
-- destroying the column they came from.
INSERT INTO "purchase_order_document_orders" ("id", "companyId", "documentId", "purchaseOrderId", "createdAt")
SELECT gen_random_uuid(), "companyId", "id", "purchaseOrderId", "createdAt"
FROM "purchase_order_documents"
WHERE "purchaseOrderId" IS NOT NULL;

-- Drop the now-superseded single FK column + its index/constraint.
DROP INDEX "purchase_order_documents_companyId_purchaseOrderId_idx";
ALTER TABLE "purchase_order_documents" DROP CONSTRAINT "purchase_order_documents_companyId_purchaseOrderId_fkey";
ALTER TABLE "purchase_order_documents" DROP COLUMN "purchaseOrderId";

-- See purchase_order_finance migration's own header comment for the full
-- story on why app_service needs an explicit grant here (superuser-owned
-- tables from `prisma migrate deploy` under MIGRATION_DATABASE_URL).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_document_orders TO app_service';
  END IF;
END
$$;
