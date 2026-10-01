-- Additive only. Telegram bot pairing fields on Employee (one shared
-- platform bot — telegramChatId/telegramPairingCode are globally unique,
-- not scoped per company) + a cosmetic provenance flag on
-- ProductionExecution. See Employee.telegramChatId's own schema comment
-- for the full design rationale.

ALTER TABLE "employees"
  ADD COLUMN "telegramChatId" TEXT,
  ADD COLUMN "telegramLinkedByUserId" UUID,
  ADD COLUMN "telegramLinkedAt" TIMESTAMPTZ(3),
  ADD COLUMN "telegramPairingCode" TEXT,
  ADD COLUMN "telegramPairingCodeExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "telegramPendingProductionOrderId" UUID;

CREATE UNIQUE INDEX "employees_telegramChatId_key" ON "employees"("telegramChatId");
CREATE UNIQUE INDEX "employees_telegramPairingCode_key" ON "employees"("telegramPairingCode");

ALTER TABLE "production_executions"
  ADD COLUMN "submittedViaTelegram" BOOLEAN NOT NULL DEFAULT false;
