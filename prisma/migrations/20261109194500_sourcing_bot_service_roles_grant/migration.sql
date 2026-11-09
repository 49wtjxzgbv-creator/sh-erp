-- Extends the narrowly-scoped BYPASSRLS `sourcing_bot_service` role
-- (prisma/migrations/20261109180000_procurement_sourcing_bot) with SELECT
-- on `roles`/`role_permissions`/`permissions` — missed in the original
-- grant. Needed because SourcingBotService#resolveIdentity checks the
-- paired user's role for the `purchase-orders:manage` permission (to gate
-- the bot's admin-only "➕ Додати постачальника" action) BEFORE any tenant
-- context exists, same structural reason the `users`/`company_memberships`
-- grants already exist. Found live in production (2026-11-09): pairing
-- succeeded but the very next step threw "permission denied for table
-- roles".
GRANT SELECT ON TABLE roles TO sourcing_bot_service;
GRANT SELECT ON TABLE role_permissions TO sourcing_bot_service;
GRANT SELECT ON TABLE permissions TO sourcing_bot_service;
