-- Migration: impersonation_refresh_tokens
--
-- P0 fix (2026-08-20): Super Admin's "Увійти як" (impersonate) button
-- generated a real access token but no refresh token, so the impersonated
-- tab could never pass middleware's httpOnly-refresh-cookie check and just
-- bounced to /login. Fixes that by letting CompaniesAdminService#impersonate
-- mint a REAL refresh token through AuthService's existing rotation/reuse-
-- detection machinery (auth.service.ts, ADR-0006) — same table, same
-- security properties as a normal login — with a hard, non-extendable
-- ceiling so an impersonation session cannot be kept alive indefinitely by
-- refreshing it (that would be an actual security regression; a normal
-- 30-day sliding refresh token would not be acceptable for this purpose).
--
-- Both new columns are null for every regular login (100% of existing
-- rows) — additive, non-breaking.
--
-- Verified via pglast (real libpg_query grammar parsing), matching this
-- project's standing hand-migration verification method (backend/README.md).

ALTER TABLE "refresh_tokens" ADD COLUMN "impersonatedBy" UUID;
ALTER TABLE "refresh_tokens" ADD COLUMN "absoluteExpiresAt" TIMESTAMPTZ(3);

-- No RLS/grant changes: refresh_tokens is already RLS-scoped (FORCE) and
-- already granted SELECT/INSERT/UPDATE to auth_service
-- (20260804000000_create_auth_service_role) — that role issues/rotates
-- impersonation-flagged tokens through the exact same code path as normal
-- ones, just with these two extra columns populated.
