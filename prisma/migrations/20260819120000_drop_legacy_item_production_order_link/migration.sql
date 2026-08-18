-- План-графік Phase A's deferred cleanup step (see
-- 20260813020000_planner_phase_a_additive's header comment): drops the old
-- 1:1 CustomerOrderItem.productionOrderId link now that
-- ProductionOrder.customerOrderItemId (batch-splitting) has been live,
-- backfilled, and reconciled (Крок 6) for a full production cycle with no
-- application code left reading the old column (confirmed by a full-repo
-- grep before this migration was written).

ALTER TABLE "customer_order_items" DROP CONSTRAINT "customer_order_items_productionOrderId_fkey";
ALTER TABLE "customer_order_items" DROP CONSTRAINT "customer_order_items_productionOrderId_key";
ALTER TABLE "customer_order_items" DROP COLUMN "productionOrderId";
