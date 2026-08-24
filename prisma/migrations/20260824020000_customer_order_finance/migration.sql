-- Migration: customer_order_finance (2026-08-24)
--
-- Adds CustomerOrderDocument/CustomerOrderPayment/CustomerOrderExpense —
-- the same PurchaseOrder-Finance money model one level up: a CustomerOrder's
-- real cost = the automatic rollup of every linked PurchaseOrder's own
-- actualCost (PurchaseOrder.sourceCustomerOrderId) PLUS whatever is
-- recorded directly here (cost documents not tied to any specific
-- purchase — packaging, delivery to the client, etc). Purely additive —
-- three new tables, no existing table/column touched, no backfill.
-- Reuses PurchaseOrderDocumentType/PurchaseOrderExpenseCategory (already
-- exist from 20260824010000_purchase_order_finance) rather than
-- duplicating near-identical enums.
--
-- FK shapes (mirrors purchase_order_documents/payments/expenses exactly):
--   customer_order_documents.customerOrderId -> customer_orders(companyId, id)   composite, CASCADE
--   customer_order_documents.counterpartyId  -> suppliers(id)                     plain, RESTRICT
--   customer_order_payments.documentId       -> customer_order_documents(companyId, id)  composite, CASCADE
--   customer_order_expenses.customerOrderId  -> customer_orders(companyId, id)   composite, CASCADE
--   customer_order_expenses.documentId       -> customer_order_documents(id)     plain, SET NULL (optional link, nullable column)
--
-- RLS: ENABLE + FORCE + tenant_isolation policy on all three, identical
-- pattern to every other tenant-scoped table.
--
-- GRANT to app_service, guarded by IF EXISTS — same fix and same reasoning
-- as 20260824010000_purchase_order_finance's own GRANT (see that file's
-- header comment for the full story): production's real DATABASE_URL role
-- is `app_service`; `ops/deploy.sh` runs the whole `prisma migrate deploy`
-- under the Postgres superuser (MIGRATION_DATABASE_URL), which owns every
-- table this migration creates, so app_service needs an explicit grant to
-- reach them. Guarded because local dev/CI have no app_service role at all
-- (they connect as app_user, a superuser there, needing no grant) — an
-- unguarded GRANT would fail with "role does not exist" on every local
-- `prisma migrate dev`/CI run.
--
-- Verified via pglast (real libpg_query grammar parsing) AND applied
-- end-to-end against a real, isolated Postgres 16 instance — full
-- migration history, a non-superuser/NOBYPASSRLS role standing in for
-- app_service, and a real Company A / Company B cross-tenant
-- SELECT/INSERT/UPDATE/DELETE test (same methodology as the PO-Finance
-- migration's own audit).

CREATE TABLE "customer_order_documents" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"       UUID NOT NULL,
    "customerOrderId" UUID NOT NULL,
    "documentType"    "PurchaseOrderDocumentType" NOT NULL,
    "documentNumber"  TEXT,
    "documentDate"    DATE,
    "counterpartyId"  UUID NOT NULL,
    "amount"          DECIMAL(14,2),
    "currency"        TEXT NOT NULL DEFAULT 'EUR',
    "note"            TEXT,
    "createdById"     UUID NOT NULL,
    "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_order_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_order_documents_companyId_id_key" ON "customer_order_documents"("companyId", "id");
CREATE INDEX "customer_order_documents_companyId_customerOrderId_idx" ON "customer_order_documents"("companyId", "customerOrderId");
CREATE INDEX "customer_order_documents_counterpartyId_idx" ON "customer_order_documents"("counterpartyId");

ALTER TABLE "customer_order_documents" ADD CONSTRAINT "customer_order_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_order_documents" ADD CONSTRAINT "customer_order_documents_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_order_documents" ADD CONSTRAINT "customer_order_documents_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE customer_order_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_order_documents
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "customer_order_payments" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"   UUID NOT NULL,
    "documentId"  UUID NOT NULL,
    "amount"      DECIMAL(14,2) NOT NULL,
    "currency"    TEXT NOT NULL DEFAULT 'EUR',
    "paidAt"      DATE NOT NULL,
    "method"      TEXT,
    "note"        TEXT,
    "createdById" UUID NOT NULL,
    "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_order_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_order_payments_companyId_documentId_idx" ON "customer_order_payments"("companyId", "documentId");

ALTER TABLE "customer_order_payments" ADD CONSTRAINT "customer_order_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_order_payments" ADD CONSTRAINT "customer_order_payments_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "customer_order_documents"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE customer_order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_order_payments
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "customer_order_expenses" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"       UUID NOT NULL,
    "customerOrderId" UUID NOT NULL,
    "category"        "PurchaseOrderExpenseCategory" NOT NULL,
    "amount"          DECIMAL(14,2) NOT NULL,
    "currency"        TEXT NOT NULL DEFAULT 'EUR',
    "description"     TEXT,
    "documentId"      UUID,
    "createdById"     UUID NOT NULL,
    "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_order_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_order_expenses_companyId_customerOrderId_idx" ON "customer_order_expenses"("companyId", "customerOrderId");
CREATE INDEX "customer_order_expenses_documentId_idx" ON "customer_order_expenses"("documentId");

ALTER TABLE "customer_order_expenses" ADD CONSTRAINT "customer_order_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_order_expenses" ADD CONSTRAINT "customer_order_expenses_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_order_expenses" ADD CONSTRAINT "customer_order_expenses_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "customer_order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE customer_order_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_order_expenses
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON customer_order_documents, customer_order_payments, customer_order_expenses TO app_service';
  END IF;
END
$$;
