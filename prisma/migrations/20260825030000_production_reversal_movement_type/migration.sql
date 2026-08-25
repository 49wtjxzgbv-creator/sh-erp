-- New StockMovementType value used when reverting a started ProductionOrder
-- back to PLANNED (ProductionOrdersService#revertStart, 2026-08-25): the
-- exact inverse of a PRODUCTION_CONSUMPTION movement, written per reversed
-- StockMovement row so the ledger shows what came back and why, distinct
-- from a plain ADJUST.
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_REVERSAL';
