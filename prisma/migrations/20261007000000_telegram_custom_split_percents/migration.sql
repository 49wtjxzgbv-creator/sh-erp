-- "Не зрозуміло за якими відсотками йде розподіл" (2026-10-07): lets a
-- multi-worker bot submission (Employee self-submit, or an admin
-- submitting for several employees) use a manually-entered percent split
-- instead of always the equal default. See schema.prisma's own comments
-- on each column.
ALTER TABLE "employees" ADD COLUMN "telegramPendingPercents" TEXT;
ALTER TABLE "employees" ADD COLUMN "telegramAwaitingPercentsInput" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users" ADD COLUMN "telegramAdminPendingPercents" TEXT;
ALTER TABLE "users" ADD COLUMN "telegramAdminAwaitingPercentsInput" BOOLEAN NOT NULL DEFAULT false;
