-- Migration: create_telegram_bot_service_role
--
-- Mirrors 20260807130000_create_import_pairing_service_role's pattern and
-- rationale (ADR-0009) for the same structural reason: the Telegram
-- webhook (`POST /telegram/webhook`, called by Telegram's servers, never
-- by an authenticated SH ERP user) must resolve an inbound message to an
-- `Employee` row purely from the Telegram chat id (or, during the one-time
-- pairing step, from a bare pairing code) — BEFORE any tenant/company
-- context exists, which is impossible under strict RLS with `app_user`
-- correctly lacking BYPASSRLS. This is a separate, equally narrow role:
-- SELECT+UPDATE on `employees` only, nothing else, no DELETE, no INSERT
-- (creating an Employee always happens through the normal authenticated
-- app_user path).
--
-- Used ONLY by backend/src/prisma/telegram-bot-prisma.service.ts, which is
-- provided ONLY by TelegramBotModule and not exported from it — same usage
-- boundary as ImportPairingPrismaService, enforced the same way (module
-- scoping, not just convention). Once an inbound message resolves to an
-- Employee (and therefore a companyId), every subsequent business
-- operation (listing production orders, creating a DRAFT
-- ProductionExecution) switches to the normal
-- `PrismaService#runInTenantTransaction` path — fully RLS-enforced, same
-- as LegacyImportService#completePairing's own handoff to
-- `runHealthCheckAndPersist` right after pairing.
--
-- Not yet run against a real Postgres instance from this migration file —
-- confirm with `\du telegram_bot_service` and a real pairing smoke test
-- before trusting it in production, same standing verification requirement
-- as every other raw-SQL migration in this project.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telegram_bot_service') THEN
    -- CHANGE THIS PASSWORD before applying to any real environment — rotate
    -- via secrets manager, never committed anywhere, same as auth_service.
    CREATE ROLE telegram_bot_service LOGIN PASSWORD 'changeme-rotate-before-production';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM telegram_bot_service;

-- employees: RLS-scoped (FORCE) — SELECT to resolve an inbound chat id or
-- pairing code to its Employee row, UPDATE to complete pairing
-- (telegramChatId/telegramLinkedByUserId/telegramLinkedAt set,
-- telegramPairingCode/telegramPairingCodeExpiresAt cleared). Every query
-- this role runs is already scoped by a value unique enough on its own
-- (the chat id or the pairing code) that cross-tenant row visibility was
-- never the risk this code path guards against — determining which
-- company a chat id belongs to is literally its job.
GRANT SELECT, UPDATE ON TABLE employees TO telegram_bot_service;

ALTER ROLE telegram_bot_service BYPASSRLS;
