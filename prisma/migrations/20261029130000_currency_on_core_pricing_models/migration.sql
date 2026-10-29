-- Multi-currency module (2026-10-29), phase 3 — one `currency` column per
-- pricing row on the four models where a human actually types a price:
-- Assembly, Product, CustomerOrder (header), PurchaseOrder (header, not
-- per-item — see schema.prisma's own comment on PurchaseOrder.currency).
-- Plain ALTER TABLE ADD COLUMN with a default — no RLS changes needed,
-- these tables already have their own tenant_isolation policy from
-- earlier migrations.

ALTER TABLE "assemblies" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'EUR';
ALTER TABLE "products" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'EUR';
ALTER TABLE "customer_orders" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'EUR';
ALTER TABLE "purchase_orders" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'EUR';
