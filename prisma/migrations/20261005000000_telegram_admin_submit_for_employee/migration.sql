-- "Подати роботу за іншого працівника" (2026-10-05): a paired User
-- (production-executions:record) can now record a ProductionExecution on
-- behalf of one or more Employees directly from the Telegram bot. Mirrors
-- Employee's own telegramPending*/telegramAwaitingPhotoForExecutionId
-- fields, kept on separate columns (see schema.prisma's User model comment).
ALTER TABLE "users" ADD COLUMN "telegramAdminPendingEmployeeIds" TEXT;
ALTER TABLE "users" ADD COLUMN "telegramAdminPendingProductionOrderId" UUID;
ALTER TABLE "users" ADD COLUMN "telegramAdminPendingWorkTaskId" UUID;
ALTER TABLE "users" ADD COLUMN "telegramAdminPendingQty" TEXT;
ALTER TABLE "users" ADD COLUMN "telegramAdminAwaitingPhotoForExecutionId" UUID;

-- Extends the telegram_bot_service BYPASSRLS role (same shape as its
-- existing `employees`/`users`/`companies` grants) to also cover
-- `company_memberships`, SELECT only: resolving a paired User's companyId
-- (to open the correct tenant transaction and live-check
-- production-executions:record) happens BEFORE any tenant context exists,
-- same structural reason as every other grant on this role.
GRANT SELECT ON TABLE company_memberships TO telegram_bot_service;
