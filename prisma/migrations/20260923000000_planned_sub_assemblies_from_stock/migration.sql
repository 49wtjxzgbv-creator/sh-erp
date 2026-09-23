-- Additive only. Persists the "Зі складу" picks from the order-creation
-- "Підвироби" dialog as intent (mirrors plannedSubAssemblies) instead of
-- claiming them immediately — the real reservation now happens once the
-- order moves to IN_PRODUCTION.
ALTER TABLE "customer_order_items"
  ADD COLUMN "plannedSubAssembliesFromStock" JSONB;
