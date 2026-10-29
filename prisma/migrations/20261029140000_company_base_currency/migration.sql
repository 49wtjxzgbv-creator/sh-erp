-- Multi-currency module (2026-10-29), phase 4 — a company's own base
-- currency: new Assembly/Product/CustomerOrder/PurchaseOrder/Quotation rows
-- default to this instead of a hardcoded EUR, and FinanceService/
-- ReportsService convert their aggregate totals into this instead of EUR.
-- Plain ALTER TABLE ADD COLUMN with a default — company_settings already
-- has its own tenant_isolation policy from earlier migrations.

ALTER TABLE "company_settings" ADD COLUMN "baseCurrency" "Currency" NOT NULL DEFAULT 'EUR';
