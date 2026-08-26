-- Backfill: a CustomerOrder still marked NEW but with a real, non-cancelled
-- ProductionOrder batch already planned against it — either a main-item
-- batch (customerOrderItemId) or a sub-assembly batch chosen at
-- order-creation time (subAssemblyForItemId) — should read IN_PRODUCTION.
-- customer-orders.service.ts#create now flips status the moment a
-- sub-assembly batch is planned, matching what giveItemToProduction already
-- did for main-item batches; this corrects orders created before that fix
-- landed, whose sub-assembly batches never flipped the parent order's own
-- status even though real production work already existed for them.
UPDATE customer_orders co
SET status = 'IN_PRODUCTION'
WHERE co.status = 'NEW'
  AND EXISTS (
    SELECT 1
    FROM customer_order_items coi
    JOIN production_orders po
      ON po."customerOrderItemId" = coi.id OR po."subAssemblyForItemId" = coi.id
    WHERE coi."customerOrderId" = co.id
      AND po.status <> 'CANCELLED'
  );
