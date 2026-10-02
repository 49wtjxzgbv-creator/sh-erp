-- Extends the narrowly-scoped BYPASSRLS `telegram_bot_service` role
-- (prisma/migrations/20261001000001_create_telegram_bot_service_role) to
-- also cover `users`, SELECT+UPDATE only — same shape as its existing
-- `employees` grant, needed for the same structural reason: resolving an
-- inbound Telegram chat id to a `User` row (for supervisor push
-- notifications) happens BEFORE any tenant/company context exists, same
-- as resolving it to an `Employee` row already does. `users` is a global
-- (non-RLS) table, so this grant is narrower in practice than the
-- `employees` one — there's no FORCE RLS to bypass here, just ordinary
-- least-privilege table access for an otherwise-unprivileged role.
GRANT SELECT, UPDATE ON TABLE users TO telegram_bot_service;

-- Also needed for the daily "хто сьогодні ще нічого не подав" reminder
-- job (TelegramBotService's @Cron handler): it must enumerate every
-- company to iterate `runInTenantTransaction` once per company (the
-- normal RLS-scoped path cannot see other tenants' rows, by design) —
-- same "SELECT only, not RLS-scoped at all, granted for completeness"
-- shape `auth_service`'s own `companies` grant already uses.
GRANT SELECT ON TABLE companies TO telegram_bot_service;
