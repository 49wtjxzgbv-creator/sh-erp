-- Migration: create_import_pairing_service_role
--
-- Mirrors 20260804000000_create_auth_service_role's pattern and rationale
-- (ADR-0009) for exactly the same structural reason: the public pairing
-- endpoint (`POST /legacy-import/connections/pair`, called by an anonymous
-- connector script, never by an authenticated SH ERP user) must look up an
-- `ImportConnection` row by `pairingCode` alone, BEFORE any tenant/company
-- context exists — which is impossible under strict RLS with `app_user`
-- correctly lacking BYPASSRLS. Rather than widening `auth_service`'s
-- narrowly-enumerated auth-only grants (users/companies/company_memberships/
-- refresh_tokens/company_branding — see that migration) to cover an
-- unrelated table, this is a SEPARATE, equally narrow role: SELECT+UPDATE
-- on `import_connections` only, nothing else, no DELETE.
--
-- Used ONLY by backend/src/prisma/import-pairing-prisma.service.ts, which
-- is provided ONLY by LegacyImportModule and not exported from it — same
-- usage boundary as AuthPrismaService, enforced the same way (module
-- scoping, not just convention). Every query this role runs is already
-- scoped by a value unique enough on its own (the pairing code) that
-- cross-tenant row visibility was never the risk this code path guards
-- against — determining which company a pairing code belongs to is
-- literally its job.
--
-- Not yet run against a real Postgres instance from this migration file —
-- confirm with `\du import_pairing_service` and a real pairing smoke test
-- before trusting it in production, same standing verification requirement
-- as every other raw-SQL migration in this project.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_pairing_service') THEN
    -- CHANGE THIS PASSWORD before applying to any real environment — rotate
    -- via secrets manager, never committed anywhere, same as auth_service.
    CREATE ROLE import_pairing_service LOGIN PASSWORD 'changeme-rotate-before-production';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM import_pairing_service;

-- import_connections: RLS-scoped (FORCE) — SELECT to look up by
-- pairingCode, UPDATE to complete pairing (status, configEncrypted,
-- protocolVersion, connectorVersion, pairedAt, pairingCode/pairingCodeExpiresAt
-- cleared). No INSERT — creating a new PENDING connection always happens
-- through the normal authenticated app_user path (an already-logged-in
-- admin clicking "Додати джерело"), never through this anonymous endpoint.
GRANT SELECT, UPDATE ON TABLE import_connections TO import_pairing_service;

ALTER ROLE import_pairing_service BYPASSRLS;
