-- Real production incident (2026-08-24): FinishedGood.serialNumber was
-- @unique GLOBALLY across the whole table, not per company, while
-- FinishedGoodsService#generateSerialNumbers generates "SN-{N}" purely
-- from THIS company's own finished-good count. Any company with few (or
-- zero) finished goods was therefore guaranteed to collide with another
-- tenant's already-taken low-numbered serial the moment it tried to
-- start() a production order — reproduced live for company "131313"
-- (0 finished goods, tried to create "SN-000001", already owned by
-- company "landing-demo"), 500 on every retry.
--
-- serialNumber is a human-readable, per-company batch label (same
-- category as an order number), not a system-wide identifier — nothing
-- in the backend or frontend ever looks one up without already being
-- scoped to a company (confirmed by grep before writing this migration).
-- Fix: unique per (companyId, serialNumber) instead of unique alone.

ALTER TABLE "finished_goods" DROP CONSTRAINT "finished_goods_serialNumber_key";

CREATE UNIQUE INDEX "finished_goods_companyId_serialNumber_key" ON "finished_goods"("companyId", "serialNumber");
