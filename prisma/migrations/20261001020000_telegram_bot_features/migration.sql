-- Additive only. Backs the next round of Telegram bot improvements
-- ("давай все окрім списку замовлень по бригаді", 2026-10-01):
--   - User.telegram* — self-service pairing so a supervisor can receive
--     push notifications (with inline Confirm/Reject) for a bot submission.
--   - Employee.telegramPending{WorkTaskId,Allocations} /
--     telegramAwaitingPhotoForExecutionId — new bot conversation-state
--     fields for general-work submissions, multi-worker allocation
--     picking, and the optional post-submit proof photo.
--   - FileDomain.PRODUCTION_EXECUTION_PHOTO — the new attachment kind for
--     that proof photo.

ALTER TABLE "users"
  ADD COLUMN "telegramChatId" TEXT,
  ADD COLUMN "telegramPairingCode" TEXT,
  ADD COLUMN "telegramPairingCodeExpiresAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId");
CREATE UNIQUE INDEX "users_telegramPairingCode_key" ON "users"("telegramPairingCode");

ALTER TABLE "employees"
  ADD COLUMN "telegramPendingWorkTaskId" UUID,
  ADD COLUMN "telegramPendingAllocations" TEXT,
  ADD COLUMN "telegramAwaitingPhotoForExecutionId" UUID;

ALTER TYPE "FileDomain" ADD VALUE 'PRODUCTION_EXECUTION_PHOTO';
