-- Migration: create_auth_service_role
--
-- Implements the `auth_service` database role, APPROVED by the owner (see
-- docs/adr/0009-auth-service-bypassrls-role.md for the full security
-- rationale, and "SH ERP v2 — Phase 3 Database Schema.md" §2c for how this
-- fits into the two-layer tenant isolation model, ADR-0002). Used ONLY by
-- backend/src/prisma/auth-prisma.service.ts, which is ONLY injected into
-- AuthService, for exactly three pre-tenant-context flows: login, refresh,
-- and company discovery (the pre-login "which company, what branding"
-- lookup). Never used once a tenant context has been resolved.
--
-- ORDERING: this must run AFTER the baseline schema migration (all
-- `CREATE TABLE` statements and the §2 RLS policies / §2b CHECK
-- constraints) and after `app_user` has already been created and
-- confirmed to NOT have `BYPASSRLS` or superuser (database-schema.md §2's
-- deployment requirement — unaffected by anything in this file). Like the
-- RLS-policy and CHECK-constraint migrations it sits alongside, this is
-- hand-authored raw SQL rather than something schema.prisma can express
-- declaratively — Prisma has no concept of Postgres roles or GRANTs.
--
-- This has not been run against a real Postgres instance — see the
-- standing verification requirement in backend/README.md. Run this for
-- real, and confirm with `\du auth_service` + a manual login/refresh
-- smoke test, before trusting it in production.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_service') THEN
    -- CHANGE THIS PASSWORD before applying to any real environment — this
    -- placeholder exists only so the statement is runnable as written.
    -- Rotate it the same way any other production database credential is
    -- rotated (secrets manager, not committed anywhere).
    CREATE ROLE auth_service LOGIN PASSWORD 'changeme-rotate-before-production';
  END IF;
END
$$;

-- Least-privilege, explicit allow-list. REVOKE ALL first so this migration
-- is safe to re-run (idempotent) and so the GRANTs below are the complete,
-- authoritative picture of what this role can do — nothing implicit.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM auth_service;

-- users: not RLS-scoped (global table) — SELECT for the login lookup by
-- email, UPDATE restricted in practice to the two columns
-- AuthService.verifyPassword's legacy-rehash path writes
-- (passwordHash/legacyPasswordHash). Postgres GRANT is table-level, not
-- column-level here, by design — narrowing further would require a
-- column-privilege GRANT or a view, which is more machinery than this
-- risk warrants (see ADR-0009's "why BYPASSRLS is safe here" argument).
GRANT SELECT, UPDATE ON TABLE users TO auth_service;

-- companies: not RLS-scoped either — SELECT for lookup by slug (login and
-- company discovery).
GRANT SELECT ON TABLE companies TO auth_service;

-- company_memberships: RLS-scoped (FORCE), SELECT only — login/refresh
-- read this to resolve which role the user has in the target company;
-- neither flow ever writes it.
GRANT SELECT ON TABLE company_memberships TO auth_service;

-- refresh_tokens: RLS-scoped (FORCE) — SELECT to look up by tokenHash,
-- INSERT to issue a new token on login/rotation, UPDATE to mark a token
-- revoked (rotation and reuse-detection revocation, ADR-0006). No DELETE —
-- revocation is a status flag (`revokedAt`), never a row removal, matching
-- the rest of the schema's "corrections are new state, not erasure"
-- convention.
GRANT SELECT, INSERT, UPDATE ON TABLE refresh_tokens TO auth_service;

-- company_branding: RLS-scoped (FORCE), SELECT only — pre-login branding
-- lookup for the "company discovery" flow (Phase 1 §3.6's
-- `getBrandingAssets`, deliberately not auth-gated in the legacy system
-- either). auth_service never writes branding — that stays an
-- authenticated, tenant-scoped write through the normal app_user path
-- (SettingsService.updateBranding).
GRANT SELECT ON TABLE company_branding TO auth_service;

-- The actual RLS bypass. Safe specifically because every query this role
-- runs is already scoped by a value that's unique enough on its own
-- (email, tokenHash, or an explicit companyId+userId pair) that
-- cross-tenant row *visibility* was never the risk on these 3 flows —
-- establishing which tenant something belongs to is the actual job of
-- this code path. This does NOT grant BYPASSRLS to app_user, which
-- remains exactly as required by database-schema.md §2. See ADR-0009 for
-- the full argument and the alternatives that were considered and
-- rejected.
ALTER ROLE auth_service BYPASSRLS;
