-- Multi-currency module (2026-10-29) — exchange-rate infrastructure.
-- See schema.prisma's own "SECTION: Currency / Exchange Rates" comment for
-- why this is two separate tables (NbuExchangeRate global/non-tenant,
-- ExchangeRateOverride tenant-scoped) rather than one table with a
-- nullable companyId.

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('EUR', 'UAH', 'USD');

-- CreateTable
CREATE TABLE "nbu_exchange_rates" (
    "id"        UUID NOT NULL,
    "currency"  "Currency" NOT NULL,
    "rate"      DECIMAL(14,6) NOT NULL,
    "asOfDate"  DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nbu_exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nbu_exchange_rates_currency_asOfDate_key" ON "nbu_exchange_rates"("currency", "asOfDate");

-- CreateTable
CREATE TABLE "exchange_rate_overrides" (
    "id"          UUID NOT NULL,
    "companyId"   UUID NOT NULL,
    "currency"    "Currency" NOT NULL,
    "rate"        DECIMAL(14,6) NOT NULL,
    "asOfDate"    DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_overrides_companyId_currency_asOfDate_key" ON "exchange_rate_overrides"("companyId", "currency", "asOfDate");

-- AddForeignKey
ALTER TABLE "exchange_rate_overrides" ADD CONSTRAINT "exchange_rate_overrides_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: exchange_rate_overrides is tenant-scoped, standard policy.
-- nbu_exchange_rates is deliberately NOT given RLS — it's shared
-- reference data (the official NBU rate is the same for every company),
-- same category as the permission catalogue/Plan table.
ALTER TABLE exchange_rate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rate_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exchange_rate_overrides
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- Guarded GRANT to app_service (production's real DATABASE_URL role) —
-- same pattern as 20260824010000_purchase_order_finance. Guarded with
-- `IF EXISTS` since local dev/CI have no `app_service` role (they connect
-- as `app_user`, which owns these tables and needs no grant).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON nbu_exchange_rates, exchange_rate_overrides TO app_service';
  END IF;
END
$$;
