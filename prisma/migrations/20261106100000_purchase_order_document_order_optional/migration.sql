-- "рахунок не обов'язково може бути прив'язаний до замовлення" (2026-11-06)
-- — a supplier-uploaded invoice does not always correspond to one specific
-- PurchaseOrder. The existing composite FK (companyId, purchaseOrderId) ->
-- (companyId, id) already only applies when purchaseOrderId IS NOT NULL
-- (Postgres MATCH SIMPLE), so dropping the NOT NULL constraint is the only
-- change needed — ON DELETE CASCADE still fires correctly for rows that do
-- have a purchaseOrderId.
ALTER TABLE "purchase_order_documents" ALTER COLUMN "purchaseOrderId" DROP NOT NULL;
