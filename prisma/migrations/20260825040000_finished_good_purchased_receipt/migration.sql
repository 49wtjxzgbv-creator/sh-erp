-- Real gap reported by the user (2026-08-25): a sub-assembly/product is not
-- always MANUFACTURED in-house — sometimes it's bought ready-made from a
-- supplier. Until now, every FinishedGood row was required to trace back to
-- a ProductionOrder (start()'s pick-list consumption + serial generation),
-- so the only way to get a purchased sub-assembly onto the shelf was to
-- fake a production run for it. FinishedGoodsService#receivePurchased adds
-- a direct receipt path instead; this migration makes room for it.

-- Composite FK -> single-column FK, since productionOrderId is now an
-- OPTIONAL relation (see schema.prisma header's §cross-tenant convention:
-- composite FK for required relations, single-column for optional ones).
ALTER TABLE "finished_goods" DROP CONSTRAINT "finished_goods_companyId_productionOrderId_fkey";

ALTER TABLE "finished_goods" ALTER COLUMN "productionOrderId" DROP NOT NULL;

ALTER TABLE "finished_goods" ADD CONSTRAINT "finished_goods_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
