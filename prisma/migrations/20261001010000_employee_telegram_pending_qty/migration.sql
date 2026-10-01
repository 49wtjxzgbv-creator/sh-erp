-- Additive only. Second piece of bot conversation state — a typed-but-
-- not-yet-confirmed quantity, shown back on a review card before the real
-- submit (see Employee.telegramPendingQty's own schema comment).
ALTER TABLE "employees"
  ADD COLUMN "telegramPendingQty" TEXT;
