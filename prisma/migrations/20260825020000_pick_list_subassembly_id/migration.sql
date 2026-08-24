-- Real gap found via user report (2026-08-25): the pick-list print
-- ("Аркуш видачі зі складу") never showed a photo column at all, unlike
-- the assembly-spec print which already resolves photos correctly.
-- ProductionOrderPickListItem already stored productId for a raw-material
-- line (letting the print resolve a Product photo), but had nothing
-- equivalent for a "finished sub-assembly consumed" line (productId null)
-- — subAssemblyId was available in production-orders.service.ts#start()
-- at the point each row is built, just never written to the row. Same
-- shape as the existing productId column: a plain snapshot UUID, no
-- Prisma @relation (matches the header comment's own framing —
-- "article/name snapshot at time of consumption" — this isn't live
-- referential integrity, just enough to resolve a photo at print time).

ALTER TABLE "production_order_pick_list_items" ADD COLUMN "subAssemblyId" UUID;
