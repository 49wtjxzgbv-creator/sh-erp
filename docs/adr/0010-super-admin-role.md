# ADR-0010: A separate global Super Admin role, with its own `BYPASSRLS` Postgres role and its own JWT secret

**Status**: Accepted (2026-08-05)

## Context

Every role this system has had until now — Admin, Storekeeper, Viewer, and any custom role a company creates — is a `Role` row scoped to exactly one `Company` (ADR-0002's tenant-scoped RBAC). There was no way to see across companies, block a company, manage plan tiers after initial seeding, or manually create a company outside the public self-service signup flow. The owner's explicit requirement, given during the 2026-08-05 production-readiness audit, was a genuinely separate system-operator role — not a more powerful `Role` inside some company, not a flag on `User` — with its own authentication, able to see every company, log into any of them, manage tariffs, block companies, and view global audit logs.

Two existing patterns were available to build on: `PrismaService.tenant` (RLS-bound, `app_user`) and `AuthPrismaService` (ADR-0009's `auth_service`, `BYPASSRLS`, narrowly scoped to 3 pre-tenant-context auth flows). Neither fits: `.tenant` cannot see across companies by construction, and widening `auth_service`'s grant list to cover companies/users/plans/subscriptions/audit-events would blur ADR-0009's own deliberately tight boundary ("used ONLY by AuthService, for exactly these three flows") — a Super Admin action is not a pre-tenant-context auth flow, it is a distinct, ongoing, cross-tenant administrative capability with its own audit trail.

## Decision

A third `BYPASSRLS` Postgres role, `super_admin_service`, used by exactly one Prisma client (`SuperAdminPrismaService`), injected only into `SuperAdminModule`'s own services — never into anything reachable from a normal per-company request.

- **Separate table, not a `User` flag**: `SuperAdmin` (schema.prisma) is its own model. A super admin is not a member of any company, has no `CompanyMembership`/`Role`, and must keep working even if a company's own admin user is deleted or locked out.
- **Separate authentication**: `SuperAdminAuthService` verifies against `SuperAdmin.passwordHash` (argon2id, same algorithm as `User`) and issues a JWT signed with `SUPER_ADMIN_JWT_SECRET` — never `JWT_ACCESS_SECRET`. `SuperAdminGuard` does its own, independent verification; it does not reuse `JwtAuthGuard`/`TenantContextMiddleware` at all. No refresh token — a super-admin session is short (`SUPER_ADMIN_JWT_TTL`, default 30m) and re-authenticating is a single form submit, not a burden worth a rotation-family mechanism.
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

- **Impersonation** ("log into any company") mints an ordinary regular-shape access token (same secret, same payload shape as `AuthService.issueTokenPair`), so the rest of the app needs zero special-casing to accept it. Deliberately access-token-only, no refresh — re-impersonating is one click. Every impersonation logs which user it acted as, not just which company.
- **`Company.status` enforcement** — a related, real gap this work exposed: the field has existed in the schema since Phase 3 (`CompanyStatus`: ACTIVE/SUSPENDED/OFFBOARDED) but nothing ever read it. "Blocking" a company would have had no actual effect. Fixed at three points: `AuthService.login`/`refresh` (a suspended company can't start or renew a session) and `TenantScopeInterceptor` (an already-issued access token stops working on its very next request, not just at its natural expiry).

## Consequences

- Positive: a genuine, auditable, structurally-separate system-operator capability exists, matching the explicit requirement — Company Admin and Super Admin share no code path, no token, no session store (frontend: `lib/super-admin/session-store.ts` vs `lib/auth/session-store.ts`), no UI (`app/super-admin/**` vs `app/(app)/**`).
- Positive: `Company.status` finally does something — closes a real, silent gap that predates this ADR.
- Negative: a third `BYPASSRLS` credential to provision, rotate, and monitor, on top of `auth_service`. Same mitigation as ADR-0009: the grant surface is small enough to review in one sitting (the table above), and `app_user` — everything else in this application — is untouched.
- Negative: impersonation's access token currently travels through a browser redirect URL (query string) once, from the Super Admin panel to the regular app's `/impersonate` landing page — visible in browser history / unredacted access logs for that one request. Accepted for now given the token's short TTL; a follow-up (POST-based handoff instead of GET) is noted in the production readiness report rather than silently treated as solved.
- Negative: the Super Admin frontend panel currently lives inside the same Next.js app/deployment as the regular frontend (`app/super-admin/**`), not a fully separate deployment — satisfies "окрема адмін-панель" at the routing/session/UI level, not at the infrastructure level. Revisit if this system's threat model ever calls for hard network-level separation.

## Alternatives considered

- **A boolean `isSuperAdmin` flag on `User`, reusing the regular login flow**: rejected — the explicit requirement was "повністю різні ролі... окрема авторизація." A shared table and shared token would make that boundary a convention, not a structural guarantee, and a super admin would awkwardly need a `CompanyMembership` somewhere to satisfy the rest of the schema's assumptions despite belonging to no company.
- **Widening `auth_service`'s grants to cover the Super Admin feature set**: rejected — blurs ADR-0009's own deliberately narrow, single-purpose boundary; a compromised credential for either role should not also compromise the other's much larger surface.
- **A fully separate frontend app/deployment for the Super Admin panel**: not done for this pass — real operational cost (a second Next.js service, a second systemd unit, a second Nginx vhost) for a benefit (network-level isolation) the current threat model doesn't yet require; documented above as a disclosed scope boundary, not an oversight.
