-- Migration: purchase_order_finance (Finance module, 2026-08-24)
--
-- Adds the Finance / "Документи та витрати" module: PurchaseOrderDocument,
-- PurchaseOrderPayment, PurchaseOrderExpense. Design confirmed in chat
-- 2026-08-24. Purely additive — three new tables, two new enums, one new
-- FileDomain enum value. No existing table/column is touched, no backfill.
--
-- Money model (see schema.prisma's own section header comment for the full
-- rationale): Document confirms an amount/operation from a counterparty;
-- Expense is a cost that counts toward the PO's actual cost (independent of
-- whether a Document exists yet); Payment pays one specific Document. Goods
-- cost is never an Expense row — it always comes from purchase_order_items,
-- so the goods invoice Document must not double it.
--
-- FK shapes:
--   purchase_order_documents.purchaseOrderId -> purchase_orders(companyId, id)   composite, CASCADE (mirrors purchase_order_items/purchase_order_comments)
--   purchase_order_documents.counterpartyId  -> suppliers(id)                     plain, RESTRICT (a supplier with financial documents on file can't be silently orphaned)
--   purchase_order_payments.documentId       -> purchase_order_documents(companyId, id)  composite, CASCADE (a payment has no meaning without its document)
--   purchase_order_expenses.purchaseOrderId  -> purchase_orders(companyId, id)   composite, CASCADE
--   purchase_order_expenses.documentId       -> purchase_order_documents(id)     plain, SET NULL (optional link — see model comment; nullable column, so kept single-column rather than composite)
--
-- RLS: ENABLE + FORCE + tenant_isolation policy on all three new tables,
-- identical pattern to every other tenant-scoped table (delivery_schedules,
-- purchase_order_comments, etc).
--
-- Explicit GRANT to app_service (bottom of this file) — a real gap found
-- while pre-production-auditing this migration against an actual isolated
-- Postgres 16 instance (2026-08-24): `ops/deploy.sh` runs the ENTIRE
-- `prisma migrate deploy` under `MIGRATION_DATABASE_URL` (the Postgres
-- superuser), which makes that superuser — not the app's own DATABASE_URL
-- role — the OWNER of every table this migration creates.
--
-- IMPORTANT correction (2026-08-24, read-only production audit): the
-- role actually named in production's `DATABASE_URL` is `app_service`, NOT
-- `app_user` as `docs/deployment.md`/`.env.example` name it everywhere —
-- confirmed by reading (never printing) the real `backend.env` on the VPS.
-- An `app_user` role does exist on production too, but it is unused by the
-- running application (superuser/BYPASSRLS/CREATEROLE, an orphaned
-- credential — a separate, pre-existing finding, not fixed here). The
-- first version of this migration granted to `app_user`, which was simply
-- the wrong target — harmless (didn't error) but did nothing for the role
-- that actually matters. Fixed here to grant `app_service` instead.
--
-- The same audit found that production ALSO already has a schema-wide
-- `ALTER DEFAULT PRIVILEGES ... TO app_service` (set directly on the
-- database, not captured in any migration file) that auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table `postgres` creates in
-- `public` — which is why `delivery_schedules`/`purchase_order_comments`
-- already work today despite neither having an explicit GRANT of their
-- own. That mechanism would likely cover these 3 tables too even without
-- this GRANT — but it lives outside version control, so this explicit,
-- committed GRANT stays as the correct, self-contained guarantee rather
-- than silently depending on undocumented production-only state.
--
-- Guarded with `IF EXISTS (... pg_roles ...)` rather than a bare GRANT:
-- neither local dev's docker-compose Postgres nor CI's ephemeral Postgres
-- has a role named `app_service` at all (both use `app_user`, which is a
-- superuser in both places and needs no grant) — an unguarded
-- `GRANT ... TO app_service` would fail with "role does not exist" on
-- every local `prisma migrate dev`/CI run. The guard makes this a no-op
-- everywhere `app_service` doesn't exist, and the real grant everywhere it
-- does.
--
-- Verified via pglast (real libpg_query grammar parsing) AND applied
-- end-to-end against a real, isolated Postgres 16 instance (2026-08-24) —
-- full migration history, a non-superuser/NOBYPASSRLS app_user role
-- standing in for the production role shape, and a real Company A /
-- Company B cross-tenant SELECT/INSERT/UPDATE/DELETE test. Production's
-- actual `app_service` role/grants were verified read-only, directly on
-- the VPS, separately (never applied to production — see the audit
-- report). See the accompanying pre-production audit report for the full
-- methodology and results of both.

CREATE TYPE "PurchaseOrderDocumentType" AS ENUM (
  'INVOICE', 'DELIVERY_NOTE', 'PROFORMA_INVOICE', 'PACKING_LIST',
  'TRANSPORT_DOCUMENT', 'CUSTOMS_DOCUMENT', 'ACT', 'OTHER'
);

CREATE TYPE "PurchaseOrderExpenseCategory" AS ENUM ('SHIPPING', 'CUSTOMS', 'INSURANCE', 'OTHER');

-- New FileDomain value only used going forward (see files module) — cannot
-- be referenced by any INSERT/UPDATE in this same transaction per Postgres
-- rules for ALTER TYPE ... ADD VALUE, which this migration does not do.
ALTER TYPE "FileDomain" ADD VALUE 'FINANCE_DOCUMENT';

CREATE TABLE "purchase_order_documents" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"       UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "documentType"    "PurchaseOrderDocumentType" NOT NULL,
    "documentNumber"  TEXT,
    "documentDate"    DATE,
    "counterpartyId"  UUID NOT NULL,
    "amount"          DECIMAL(14,2),
    "currency"        TEXT NOT NULL DEFAULT 'EUR',
    "note"            TEXT,
    "createdById"     UUID NOT NULL,
    "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_documents_companyId_id_key" ON "purchase_order_documents"("companyId", "id");
CREATE INDEX "purchase_order_documents_companyId_purchaseOrderId_idx" ON "purchase_order_documents"("companyId", "purchaseOrderId");
CREATE INDEX "purchase_order_documents_counterpartyId_idx" ON "purchase_order_documents"("counterpartyId");

ALTER TABLE "purchase_order_documents" ADD CONSTRAINT "purchase_order_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_documents" ADD CONSTRAINT "purchase_order_documents_companyId_purchaseOrderId_fkey" FOREIGN KEY ("companyId", "purchaseOrderId") REFERENCES "purchase_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_documents" ADD CONSTRAINT "purchase_order_documents_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE purchase_order_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_documents
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "purchase_order_payments" (
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

    CONSTRAINT "purchase_order_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_payments_companyId_documentId_idx" ON "purchase_order_payments"("companyId", "documentId");

ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "purchase_order_documents"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE purchase_order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_payments
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "purchase_order_expenses" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"       UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "category"        "PurchaseOrderExpenseCategory" NOT NULL,
    "amount"          DECIMAL(14,2) NOT NULL,
    "currency"        TEXT NOT NULL DEFAULT 'EUR',
    "description"     TEXT,
    "documentId"      UUID,
    "createdById"     UUID NOT NULL,
    "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_expenses_companyId_purchaseOrderId_idx" ON "purchase_order_expenses"("companyId", "purchaseOrderId");
CREATE INDEX "purchase_order_expenses_documentId_idx" ON "purchase_order_expenses"("documentId");

ALTER TABLE "purchase_order_expenses" ADD CONSTRAINT "purchase_order_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_expenses" ADD CONSTRAINT "purchase_order_expenses_companyId_purchaseOrderId_fkey" FOREIGN KEY ("companyId", "purchaseOrderId") REFERENCES "purchase_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_expenses" ADD CONSTRAINT "purchase_order_expenses_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "purchase_order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE purchase_order_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_expenses
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- See this file's header comment for the full story. Production's real
-- DATABASE_URL role is `app_service` (confirmed by a read-only audit of
-- the live VPS, 2026-08-24) — the Postgres superuser used by
-- `ops/deploy.sh` (`MIGRATION_DATABASE_URL`) owns every table this
-- migration creates, so `app_service` needs an explicit grant to reach
-- them at all. Guarded by `IF EXISTS`: local dev/CI have no `app_service`
-- role (they connect as `app_user`, a superuser in both places, which
-- needs no grant) — an unguarded GRANT would fail there with "role
-- app_service does not exist". This intentionally does NOT touch
-- `app_user` in any environment, and does not modify or rely on altering
-- production's existing (out-of-band) default-privilege configuration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_documents, purchase_order_payments, purchase_order_expenses TO app_service';
  END IF;
END
$$;
