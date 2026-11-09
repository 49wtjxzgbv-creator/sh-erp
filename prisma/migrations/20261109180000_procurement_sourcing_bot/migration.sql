-- Procurement sourcing bot (2026-11-09) — "потрібен якийсь зручний бот
-- телеграм щоб це всек було зручно опрацьовувати по категоріях з списком
-- можливих постачальників текстом який писати та наявною ціною". New
-- tables: sourcing_categories, sourcing_candidate_suppliers,
-- sourcing_outreaches. One new nullable column on products
-- (sourcingCategoryId). Three new nullable columns on users
-- (sourcingBotChatId/sourcingBotPairingCode/sourcingBotPairingCodeExpiresAt)
-- for a SEPARATE bot/token from the existing telegram_bot_service's one.
--
-- Deliberately does NOT duplicate Product's own germanPriceExclVat/
-- germanPriceInclVat/localPriceExclVat/localPriceInclVat/sellPriceEur —
-- the bot reads those live, see schema.prisma's Product.sourcingCategoryId
-- comment for why.
--
-- Purely additive — three new tables, one new enum, four new nullable
-- columns across two existing tables. No existing row is touched.

-- CreateEnum
CREATE TYPE "SourcingOutreachStatus" AS ENUM ('NOT_CONTACTED', 'CONTACTED', 'AWAITING_RESPONSE', 'RESPONDED', 'QUOTE_RECEIVED', 'REJECTED', 'WON');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "sourcingCategoryId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "sourcingBotChatId" TEXT,
ADD COLUMN "sourcingBotPairingCode" TEXT,
ADD COLUMN "sourcingBotPairingCodeExpiresAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "sourcing_categories" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rfqTemplate" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "sourcing_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_candidate_suppliers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "location" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "whatTheyDo" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web_search',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "sourcing_candidate_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_outreaches" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "candidateSupplierId" UUID NOT NULL,
    "status" "SourcingOutreachStatus" NOT NULL DEFAULT 'NOT_CONTACTED',
    "lastNote" TEXT,
    "quotedPriceEur" DECIMAL(14,2),
    "quotedPriceNote" TEXT,
    "contactedByUserId" UUID,
    "contactedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sourcing_outreaches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_categories_companyId_code_key" ON "sourcing_categories"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_categories_companyId_id_key" ON "sourcing_categories"("companyId", "id");

-- CreateIndex
CREATE INDEX "sourcing_categories_companyId_sortOrder_idx" ON "sourcing_categories"("companyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_candidate_suppliers_companyId_id_key" ON "sourcing_candidate_suppliers"("companyId", "id");

-- CreateIndex
CREATE INDEX "sourcing_candidate_suppliers_companyId_categoryId_idx" ON "sourcing_candidate_suppliers"("companyId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_outreaches_companyId_candidateSupplierId_key" ON "sourcing_outreaches"("companyId", "candidateSupplierId");

-- CreateIndex
CREATE INDEX "sourcing_outreaches_companyId_status_idx" ON "sourcing_outreaches"("companyId", "status");

-- CreateIndex
CREATE INDEX "products_companyId_sourcingCategoryId_idx" ON "products"("companyId", "sourcingCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "users_sourcingBotChatId_key" ON "users"("sourcingBotChatId");

-- CreateIndex
CREATE UNIQUE INDEX "users_sourcingBotPairingCode_key" ON "users"("sourcingBotPairingCode");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sourcingCategoryId_fkey" FOREIGN KEY ("sourcingCategoryId") REFERENCES "sourcing_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_categories" ADD CONSTRAINT "sourcing_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_candidate_suppliers" ADD CONSTRAINT "sourcing_candidate_suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_candidate_suppliers" ADD CONSTRAINT "sourcing_candidate_suppliers_companyId_categoryId_fkey" FOREIGN KEY ("companyId", "categoryId") REFERENCES "sourcing_categories"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_outreaches" ADD CONSTRAINT "sourcing_outreaches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_outreaches" ADD CONSTRAINT "sourcing_outreaches_companyId_candidateSupplierId_fkey" FOREIGN KEY ("companyId", "candidateSupplierId") REFERENCES "sourcing_candidate_suppliers"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to every other new company-scoped table).
-- ---------------------------------------------------------------------

ALTER TABLE sourcing_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sourcing_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sourcing_categories
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE sourcing_candidate_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sourcing_candidate_suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sourcing_candidate_suppliers
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE sourcing_outreaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sourcing_outreaches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sourcing_outreaches
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have
-- no app_service role at all. Same shape as cutting_stock_optimization's
-- own grant block.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sourcing_categories TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sourcing_candidate_suppliers TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sourcing_outreaches TO app_service';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- New BYPASSRLS role `sourcing_bot_service` — mirrors
-- 20261001000001_create_telegram_bot_service_role's pattern exactly, but
-- kept as its OWN role (not reusing telegram_bot_service) so this new,
-- separately-deployed, less-trusted bot's blast radius stays independent
-- of the existing production-notifications bot's role. Resolves a bare
-- Telegram chat id / pairing code to a `users` row BEFORE any tenant
-- context exists (same structural problem telegram_bot_service already
-- solves for its own bot) — SELECT+UPDATE on `users` only, no DELETE, no
-- INSERT (creating a User always happens through the normal authenticated
-- app_user path). Also SELECT on `company_memberships` + `companies`, to
-- resolve which company a paired user acts in (this bot assumes exactly
-- one membership per user; see SourcingBotService's own comment for the
-- fallback if that assumption ever breaks).
--
-- CHANGE THIS PASSWORD before applying to any real environment — rotate
-- via secrets manager, never committed anywhere, same standing note as
-- every sibling service-role migration.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sourcing_bot_service') THEN
    CREATE ROLE sourcing_bot_service LOGIN PASSWORD 'changeme-rotate-before-production';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sourcing_bot_service;

GRANT SELECT, UPDATE ON TABLE users TO sourcing_bot_service;
GRANT SELECT ON TABLE company_memberships TO sourcing_bot_service;
GRANT SELECT ON TABLE companies TO sourcing_bot_service;

ALTER ROLE sourcing_bot_service BYPASSRLS;
