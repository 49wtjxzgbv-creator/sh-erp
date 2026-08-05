# ADR-0009: A separate, narrowly-scoped `BYPASSRLS` role for pre-tenant-context authentication

**Status**: Accepted (2026-08-04)

## Context
ADR-0002 established Postgres Row-Level Security as the DB-layer half of tenant isolation: every tenant-scoped table is `FORCE ROW LEVEL SECURITY`, and the application's normal database role (`app_user`) must not have `BYPASSRLS` or superuser (database-schema.md §2's deployment requirement). A tenant-scoped query only sees rows once the request has issued `SET LOCAL app.current_company_id = '...'` inside its transaction.

Three flows structurally cannot know a `companyId` before they run, because determining it is their entire job:
- **Login** (`AuthService.login`) — resolves which company a user is signing into from an email + a chosen company slug, then must read `company_memberships` (RLS-scoped) to confirm access and issue tokens via `refresh_tokens` (RLS-scoped).
- **Refresh** (`AuthService.refresh`) — looks up a presented token by its hash in `refresh_tokens` (RLS-scoped) before it knows which company that token belongs to.
- **Company discovery** (`AuthService.getPublicCompanyInfo`) — the pre-login "which company, what branding" lookup a login screen needs before anyone has authenticated (Phase 1 §3.6's `getBrandingAssets`, which the legacy system deliberately left un-auth-gated). Reads `company_branding` (RLS-scoped).

This wasn't caught during the Phase 3 schema/RLS design because no code existed yet to exercise these paths against real RLS — it surfaced during Phase 5 implementation, was flagged rather than silently worked around (`backend/src/prisma/auth-prisma.service.ts`'s original header comment, database-schema.md §2c marked "proposed"), and is now approved and implemented here.

## Decision
A second Postgres role, `auth_service`, distinct from `app_user`, with `BYPASSRLS` — used by exactly one Prisma client (`AuthPrismaService`), injected into exactly one service (`AuthService`), for exactly the three flows above. Table-level `GRANT`s bound what it can actually do regardless of the RLS bypass:

| Table | Grants | Why |
|---|---|---|
| `users` | SELECT, UPDATE | Login lookup by email; UPDATE only for the legacy-password-rehash write (Phase 0 decision). Not RLS-scoped anyway. |
| `companies` | SELECT | Lookup by slug (login, company discovery). Not RLS-scoped anyway. |
| `company_memberships` | SELECT | Resolve access/role for login and refresh. Never written by this role. |
| `refresh_tokens` | SELECT, INSERT, UPDATE | Look up by tokenHash, issue on login/rotation, mark revoked. No DELETE — revocation is a status flag, never a row removal. |
| `company_branding` | SELECT | Pre-login branding lookup only. Writing branding stays an authenticated, tenant-scoped operation on the normal `app_user` path. |

No other table is granted to this role. The raw `CREATE ROLE`/`GRANT`/`ALTER ROLE ... BYPASSRLS` SQL lives in `prisma/migrations/20260804000000_create_auth_service_role/migration.sql`, ordered to run after the baseline schema + RLS-policy migration.

**Usage boundary, enforced structurally, not just by convention**: `AuthPrismaService` is provided only by `IdentityModule` and is not exported from it, so no other module can inject it — there is no code path by which a request that has already resolved a tenant context (i.e., anything reachable after `TenantScopeInterceptor` runs) could reach this client. Every method that uses it is on an `@Public()` route.

## Consequences
- Positive: login, refresh, and pre-login company/branding discovery actually work under strict RLS — without this, none of the three could function at all once RLS is enforced for real (not a degradation; a hard failure).
- Positive: the blast radius of `BYPASSRLS` is bounded to 5 tables and specific verbs, not "this role sees everything" — a compromised `auth_service` credential could not read arbitrary tenant data (customer orders, stock, payroll, etc.), only the narrow set of columns these three flows already expose by design.
- Positive: `app_user` — the role every other line of application code runs as — is untouched and still correctly lacks `BYPASSRLS`, so the RLS guarantee described in ADR-0002 continues to hold everywhere else without exception.
- Negative: a second production database credential to provision, rotate, and monitor. Mitigated by the same secrets-management discipline as `DATABASE_URL`/`AUTH_DATABASE_URL` already requires, and by the fact that its grant surface is small enough to review in one sitting (the table above).
- Negative: `BYPASSRLS` is a coarse Postgres primitive — it bypasses RLS on every table this role could otherwise touch, not just the 5 granted ones. This is why the `GRANT`s are the real safety boundary, not the `BYPASSRLS` flag by itself: a role with `BYPASSRLS` but no `GRANT` on a table still can't touch it. Documented explicitly so a future reviewer doesn't assume `BYPASSRLS` alone is the whole story.

## Alternatives considered
- **Non-`FORCE` RLS on just these tables, so the table owner bypasses it**: rejected — running the application as the table owner would defeat RLS for `app_user` too (owner bypass is per-role, not per-connection-purpose), reintroducing exactly the risk ADR-0002 closes.
- **A permissive RLS policy on these 4-5 tables that allows the unscoped case**: rejected — a policy like `USING (current_setting('app.current_company_id', true) IS NULL OR company_id = current_setting(...))` would also let ANY connection with no session variable set see everything on that table, not just this one role — much larger blast radius than a distinct role with explicit, auditable `GRANT`s.
- **A dedicated small service (or serverless function) that owns only these 4-5 tables outright**: architecturally cleaner in isolation, but adds a second deployable/data-access surface for a Phase 5 modular monolith (ADR-0001) that doesn't otherwise need one yet — revisit if/when auth is ever split out as its own service.
- **Do nothing / accept login as permanently broken under RLS**: not viable — login is not optional.
