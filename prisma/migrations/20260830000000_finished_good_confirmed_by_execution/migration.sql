-- Склад: "В роботі" vs "Готова продукція" (2026-08-30 user request) — a
-- manufactured unit is created IN_STOCK the instant its batch is started
-- (before any human has confirmed doing the work), so the existing
-- IN_STOCK-only view was really "everything ever started," not genuinely
-- finished goods. This column is stamped once a worker's completion is
-- actually confirmed (and PayrollEntry recorded) via
-- ProductionExecutionsService#confirm(), reversed by void_(). No RLS/grant
-- changes needed — finished_goods already has both from its own migration.

ALTER TABLE "finished_goods" ADD COLUMN "confirmedByExecutionId" UUID;

CREATE INDEX "finished_goods_confirmedByExecutionId_idx" ON "finished_goods"("confirmedByExecutionId");
