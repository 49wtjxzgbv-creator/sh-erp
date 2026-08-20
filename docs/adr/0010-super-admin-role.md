# ADR-0010: A separate global Super Admin role, with its own `BYPASSRLS` Postgres role and its own JWT secret

**Status**: Accepted (2026-08-05)

## Context

Every role this system has had until now — Admin, Storekeeper, Viewer, and any custom role a company creates — is a `Role` row scoped to exactly one `Company` (ADR-0002's tenant-scoped RBAC). There was no way to see across companies, block a company, manage plan tiers after initial seeding, or manually create a company outside the public self-service signup flow. The owner's explicit requirement, given during the 2026-08-05 production-readiness audit, was a genuinely separate system-operator role — not a more powerful `Role` inside some company, not a flag on `User` — with its own authentication, able to see every company, log into any of them, manage tariffs, block companies, and view global audit logs.

Two existing patterns were available to build on: `PrismaService.tenant` (RLS-bound, `app_user`) and `AuthPrismaService` (ADR-0009's `auth_service`, `BYPASSRLS`, narrowly scoped to 3 pre-tenant-context auth flows). Neither fits: `.tenant` cannot see across companies by construction, and widening `auth_service`'s grant list to cover companies/users/plans/subscriptions/audit-events would blur ADR-0009's own deliberately tight boundary ("used ONLY by AuthService, for exactly these three flows") — a Super Admin action is not a pre-tenant-context auth flow, it is a distinct, ongoing, cross-tenant administrative capability with its own audit trail.

## Decision

A third `BYPASSRLS` Postgres role, `super_admin_service`, used by exactly one Prisma client (`SuperAdminPrismaService`), injected only into `SuperAdminModule`'s own services — never into anything reachable from a normal per-company request.

- **Separate table, not a `User` flag**: `SuperAdmin` (schema.prisma) is its own model. A super admin is not a member of any company, has no `CompanyMembership`/`Role`, and must keep working even if a company's own admin user is deleted or locked out.
- **Separate authentication**: `SuperAdminAuthService` verifies against `SuperAdmin.passwordHash` (argon2id, same algorithm as `User`) and issues a JWT signed with `SUPER_ADMIN_JWT_SECRET` — never `JWT_ACCESS_SECRET`. `SuperAdminGuard` does its own, independent verification; it does not reuse `JwtAuthGuard`/`TenantContextMiddleware` at all. Access token TTL is short (`SUPER_ADMIN_JWT_TTL`, default 15m — see the 2026-08-20 update below for why this is no longer "no refresh token").
- **Separate audit trail**: `SuperAdminAuditLog`, not `AuditEvent` — a super-admin action (blocking a company, changing a plan) often has no single `companyId` to attach to, and `AuditEvent.companyId` is required/RLS-scoped by design.
- **Table-level grants**, least-privilege, mirroring ADR-0009's own table:

| Table | Grants | Why |
|---|---|---|
| `super_admins` | SELECT, INSERT, UPDATE, DELETE | This role's own data. |
| `super_admin_audit_log` | SELECT, INSERT | Append-only, same convention as `AuditEvent`. |
| `companies` | SELECT, INSERT, UPDATE | See all companies; create manually; block/unblock via `.status`. |
| `users` | SELECT, INSERT | See all users; resolve who to impersonate as. |
| `company_memberships` | SELECT | Resolve a company's members for impersonation. |
| `roles` | SELECT | Read-only context (which role an impersonated user has). |
| `plans` | SELECT, INSERT, UPDATE | Manage tariffs — previously seed-only, with no endpoint to create or edit one at all (a real gap this ADR also closes). |
| `company_subscriptions` | SELECT, UPDATE | Change a company's plan. |
| `audit_events` | SELECT | Global audit log view, read-only. |

No DELETE on any tenant table — matches this schema's "corrections are new state, never erasure" convention.

- **Impersonation** ("log into any company") mints an ordinary regular-shape access+refresh token pair via `AuthService.issueImpersonationSession` (same secret/table/rotation machinery as `AuthService.issueTokenPair`), so the rest of the app needs zero special-casing to accept it — see the 2026-08-20 update below for why this changed from access-token-only. Every impersonation logs which user it acted as, not just which company.
- **`Company.status` enforcement** — a related, real gap this work exposed: the field has existed in the schema since Phase 3 (`CompanyStatus`: ACTIVE/SUSPENDED/OFFBOARDED) but nothing ever read it. "Blocking" a company would have had no actual effect. Fixed at three points: `AuthService.login`/`refresh` (a suspended company can't start or renew a session) and `TenantScopeInterceptor` (an already-issued access token stops working on its very next request, not just at its natural expiry).

## Consequences

- Positive: a genuine, auditable, structurally-separate system-operator capability exists, matching the explicit requirement — Company Admin and Super Admin share no code path, no token, no session store (frontend: `lib/super-admin/session-store.ts` vs `lib/auth/session-store.ts`), no UI (`app/super-admin/**` vs `app/(app)/**`).
- Positive: `Company.status` finally does something — closes a real, silent gap that predates this ADR.
- Negative: a third `BYPASSRLS` credential to provision, rotate, and monitor, on top of `auth_service`. Same mitigation as ADR-0009: the grant surface is small enough to review in one sitting (the table above), and `app_user` — everything else in this application — is untouched.
- Negative: the Super Admin frontend panel currently lives inside the same Next.js app/deployment as the regular frontend (`app/super-admin/**`), not a fully separate deployment — satisfies "окрема адмін-панель" at the routing/session/UI level, not at the infrastructure level. Revisit if this system's threat model ever calls for hard network-level separation.

## Update (2026-08-20)

Live use of the panel during a production-support session exposed two real gaps this ADR's original decisions didn't hold up under:

- **Impersonation had no working handoff.** The access-token-only design above was correct on its own terms, but the frontend's `/impersonate` landing page put the token in a URL query string and redirected — `middleware.ts` requires an httpOnly `sh_refresh_token` cookie to accept a request, which that flow never set, so every impersonation attempt just bounced to `/login`. Fixed by having `CompaniesAdminService.impersonate` call the new `AuthService.issueImpersonationSession` (a real access+refresh pair through the existing rotation/reuse-detection machinery, ADR-0006), capped by a hard, non-extendable `absoluteExpiresAt` ceiling (`IMPERSONATION_SESSION_TTL_HOURS`, default 1h) so this stays meaningfully different from a normal 30-day session. The handoff itself moved from a GET redirect with the token in the query string to a same-origin `POST /api/auth/impersonate` route that sets the cookie directly — the query-string exposure this ADR originally accepted no longer exists.
- **"No refresh token, re-authenticating is a single form submit" didn't hold up under sustained use.** A reload or new tab logged the Super Admin out mid-session, which was real friction, not an accepted tradeoff, once the panel was used for actual work rather than one-off actions. `SuperAdminAuthService` now issues a `SuperAdminRefreshToken` (own table, own rotation/reuse-detection, ADR-0006 shape) alongside the access token; the access token TTL was lowered (30m → 15m) since a silent refresh now exists to cover normal use, and the refresh token itself carries a hard ceiling (`SUPER_ADMIN_REFRESH_TTL_HOURS`, default 12h) so the session still cannot be kept alive indefinitely just by staying active.
- **A permission-less "one role" model was too coarse to gate impersonation specifically.** Every Super Admin previously had identical, unconditional rights. A minimal RBAC layer (`SuperAdminRole`/`SuperAdminPermission`/`SuperAdminRolePermission`, global — no `companyId`, unlike the tenant-side equivalents) now gates the impersonate endpoint specifically (`companies:impersonate`), enforced by a plain `SuperAdminPermissionGuard` (not an Interceptor — there's no RLS transaction to wrap here, unlike the tenant side's `TenantScopeInterceptor`). Every pre-existing Super Admin account was grandfathered into an all-permissions system role by the migration itself, so this is additive, not a lockout.

## Alternatives considered

- **A boolean `isSuperAdmin` flag on `User`, reusing the regular login flow**: rejected — the explicit requirement was "повністю різні ролі... окрема авторизація." A shared table and shared token would make that boundary a convention, not a structural guarantee, and a super admin would awkwardly need a `CompanyMembership` somewhere to satisfy the rest of the schema's assumptions despite belonging to no company.
- **Widening `auth_service`'s grants to cover the Super Admin feature set**: rejected — blurs ADR-0009's own deliberately narrow, single-purpose boundary; a compromised credential for either role should not also compromise the other's much larger surface.
- **A fully separate frontend app/deployment for the Super Admin panel**: not done for this pass — real operational cost (a second Next.js service, a second systemd unit, a second Nginx vhost) for a benefit (network-level isolation) the current threat model doesn't yet require; documented above as a disclosed scope boundary, not an oversight.
