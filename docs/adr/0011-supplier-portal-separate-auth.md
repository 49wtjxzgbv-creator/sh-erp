# ADR-0011: A separate Supplier Portal auth surface, with its own JWT secret and a fourth narrowly-scoped `BYPASSRLS` role

**Status**: Accepted (2026-08-13)

## Context

The owner asked for suppliers to have their own login — synchronized on orders/prices/deliveries/schedules — so a supplier can see and confirm **only their own** purchase orders, with no access to the rest of a company's data (other suppliers, products, financials, etc.). Confirmed scope: a portal login for the supplier, not a cross-tenant sync between two different SH ERP companies.

`RequestUser`/`TenantContextMiddleware`/`TenantScopeInterceptor` all hard-assume "authenticated = a `User` row that is a member of exactly one `Company` with a `Role`" (`TenantScopeInterceptor`'s own permission-checking logic reads `role.permissions`). A supplier's entire authorization scope — "my own purchase orders, nothing else" — doesn't fit that shape any more than a Super Admin's did (ADR-0010): giving a supplier a `Role`/`CompanyMembership` would overstate what they can do (a `Role`'s permissions are company-wide by construction) and understate how narrow the real boundary needs to be (not just "read-only", but "only rows where `supplierId` = mine").

## Decision

Two separate mechanisms, for two separate problems:

**1. Data access (after login) reuses the regular tenant client, narrowed at the app layer.**
`SupplierPortalGuard` verifies a JWT signed with `SUPPLIER_PORTAL_JWT_SECRET` (payload `{ sub, supplierId, companyId, type: 'supplier_portal' }`), never `JWT_ACCESS_SECRET` or `SUPER_ADMIN_JWT_SECRET`. `SupplierPortalScopeInterceptor` then opens the same `app_user`/RLS-scoped transaction every other tenant request uses (`PrismaService.runInTenantTransaction`), keyed off the token's `companyId`. RLS enforces the company boundary exactly as it does everywhere else (ADR-0002) — it does **not** enforce the supplier boundary; `SupplierPortalService` adds an explicit `where: { supplierId }` (or `findFirst({ where: { id, supplierId } })`, never a bare `findUnique({ where: { id } })`) in every single method, so a guessed/enumerated id belonging to a different supplier 404s instead of leaking.

**2. Login is a genuine pre-tenant-context problem, solved the same way ADR-0009 solved it for `AuthService`.**
Looking a `SupplierPortalUser` up by email has to happen *before* a `companyId` is known — determining it is the point of the lookup — which is structurally impossible through `supplier_portal_users`' `FORCE ROW LEVEL SECURITY` via `app_user`. `AuthPrismaService` (ADR-0009's `auth_service` role) is not reusable here: it's provided only by `IdentityModule` and deliberately not exported, and widening its grants to a fourth table for an unrelated feature would blur that same tight boundary ADR-0009 itself argued against widening for Super Admin. So this mints a **fourth** `BYPASSRLS` role, `supplier_portal_auth_service`, used by exactly one client (`SupplierPortalAuthPrismaService`), provided only by `SupplierPortalModule` and not exported from it. Grants: `SELECT, UPDATE` on `supplier_portal_users` (SELECT for the login lookup, UPDATE for `lastLoginAt`), plus (2026-08-20 update below) `SELECT, INSERT, UPDATE` on `supplier_portal_refresh_tokens` for the same pre-tenant-context reason. No INSERT/DELETE on `supplier_portal_users` itself: creating or deactivating a portal account happens through the normal `app_user` path (`SuppliersController#portal-invite`/`#portal-deactivate`, internal staff, already inside a real tenant context), a different code path than login.

Other decisions:
- **Separate table, not a `User` flag** — `SupplierPortalUser`, one row per `Supplier` (`@unique` FK), not a member of anything.
- **Long-lived session, short access token** (`SUPPLIER_PORTAL_JWT_TTL`, default 30m, plus a `SupplierPortalRefreshToken` — see the 2026-08-20 update below for why this replaced the original "no refresh token, 7d access token" design).
- **`SupplierPortalUser.email` is globally unique**, not `@@unique([companyId, email])` — same choice as `SuperAdmin.email`. Accepted limitation: a real-world supplier company that does business with two different SH ERP tenant companies cannot use the identical email for both portal accounts (they'd need a second address). Revisit if this actually becomes a real complaint — not worth a company-picker login flow to pre-solve for zero observed demand.
- **Confirmation fields are additive, never overwrite internal data**: `PurchaseOrder.supplierConfirmedAt`/`supplierConfirmedDeliveryDate` and `PurchaseOrderItem.supplierConfirmedPrice` sit alongside the existing `expectedDeliveryDate`/`expectedPrice`/`actualPrice` — "what we asked for" and "what staff recorded" stay exactly as they were; "what the supplier told us" is a new, separate signal for staff to read and act on manually, not an automatic overwrite.
- **Onboarding mirrors `UsersService.invite()` exactly**: generate a random temp password, hash with argon2, email it via the existing `EmailService`, also return it once in the API response (since `EmailService.send` can silently not-deliver if SMTP isn't configured — its own documented tradeoff).

## Consequences

- Positive: a supplier's session structurally cannot reach anything outside its own purchase orders — not through a convention or a forgotten `where` clause somewhere, but because the token type is rejected by every other guard in the system and the one guard that accepts it is paired with a service that filters by `supplierId` on every read.
- Positive: reuses `app_user`/RLS for the actual data access (no new bypass surface for purchase-order reads/writes) — the only new `BYPASSRLS` grant is one table, two verbs, confined to the login lookup.
- Negative: a **fourth** `BYPASSRLS` production credential to provision, rotate, and monitor (`app_user`, `auth_service`, `super_admin_service`, now `supplier_portal_auth_service`). Mitigated the same way as ADR-0009/0010: the grant surface is one table, two verbs — reviewable in a sentence, not a sitting.
- Negative: the `supplierId`-level boundary is app-layer discipline inside `SupplierPortalService`, not a second RLS session variable enforced by Postgres itself — weaker in the abstract than the company boundary. Accepted because the module is small and every method is already written to filter explicitly (this ADR, and the code review that follows it, is the actual safety net); revisit with a second RLS policy (`app.current_supplier_id`) if this module ever grows past a handful of read/confirm endpoints.
- Negative: same "supplier can't share one email across two tenant companies' portals" limitation noted above.

## Update (2026-08-20)

Live production-support testing found that "no refresh token, 7-day access token" didn't actually deliver what it was meant to: a page reload or new tab still logged the supplier out mid-session (the token lives only in an in-memory store, never persisted), so the intended "tolerate a long working session without re-prompting" benefit didn't hold — a reload was exactly as disruptive as it would be with a 30-minute token.

Fixed by adding a `SupplierPortalRefreshToken` table (own rotation/reuse-detection, ADR-0006 shape — sliding `SUPPLIER_PORTAL_REFRESH_TTL_DAYS`, default 30d, deliberately **no** extra absolute ceiling, unlike Super Admin's new refresh token: the "occasional, low-privilege external user" risk acceptance this ADR already argued for still applies) and shortening the access token itself (`SUPPLIER_PORTAL_JWT_TTL`, 7d → 30m) now that a silent refresh exists to renew it. The `supplierId`-scoped risk boundary this ADR's Decision section describes is unchanged — only *how long a session can survive without re-entering a password* changed, not what it can access. `SupplierPortalScopeInterceptor`/`SupplierPortalService`'s per-request `supplierId` filtering is untouched.

## Alternatives considered

- **A second RLS session variable (`app.current_supplier_id`) enforced by Postgres policies on `purchase_orders`/`purchase_order_items`**: more structurally rigorous, rejected for this pass as disproportionate to a module with exactly three narrow, already-reviewed endpoints — revisit if the portal's surface grows.
- **Reusing `AuthPrismaService` for supplier-portal login by exporting it from `IdentityModule`**: rejected — breaks that service's own documented, deliberate "not exported, no other module can inject it" boundary for an unrelated feature.
- **A `SupplierPortalUser.email` unique per company** (`@@unique([companyId, email])`) with a company-selector step on login: rejected for now — real complexity (disambiguation UI) for a scenario (one supplier, two SH ERP tenant companies, identical email) with zero observed demand; `SuperAdmin.email`'s existing global-unique precedent was simpler and consistent.
- **Cross-tenant sync between two SH ERP companies' data** (the supplier's own SH ERP account, if they had one, pushing/pulling directly): explicitly out of scope per the clarified requirement — this is a portal login for a `Supplier` row inside one company, not a company-to-company integration.
