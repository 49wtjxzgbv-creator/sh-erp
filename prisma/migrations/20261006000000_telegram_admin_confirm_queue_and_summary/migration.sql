-- "На підтвердження" / "Сьогодні записано мною" / "Підсумок по
-- працівнику" (2026-10-06): the confirm-queue and today-submissions
-- features read existing columns/tables only (ProductionExecution.status,
-- ProductionExecution.recordedById, PayrollEntry) — no new storage needed
-- for those. The employee-summary mini-flow needs exactly one transient
-- flag on User (see schema.prisma's own comment on the column).
ALTER TABLE "users" ADD COLUMN "telegramAdminAwaitingSummaryQuery" BOOLEAN NOT NULL DEFAULT false;
