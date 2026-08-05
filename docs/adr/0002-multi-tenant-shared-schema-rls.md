# ADR-0002: Multi-tenant via shared schema + `company_id` + Postgres RLS

**Status**: Accepted (2026-08-04)

## Context
The owner's Phase 0 decision is multi-tenant from day one, at a target scale of "thousands of companies." Every table needs a tenant-isolation strategy that (a) is safe against cross-tenant data leaks and (b) doesn't collapse operationally at that scale.

## Decision
One shared Postgres schema. Every tenant-scoped table carries a `companyId` column. Isolation is enforced at **two independent layers**: Postgres Row-Level Security policies (`USING (company_id = current_setting('app.current_company_id')::uuid)`, set per request transaction) as the database-layer guarantee, and a Prisma Client Extension that automatically injects `companyId` into every query and write for tenant-scoped models (reading it from an `AsyncLocalStorage`-backed request context) as the application-layer guarantee. `companyId` is resolved exclusively from the verified JWT claim on each authenticated request — never trusted from a URL, subdomain, or header alone.

## Consequences
- Positive: one database to operate, back up, and migrate — migrations run once, not once per tenant.
- Positive: two independent enforcement layers mean a bug in one (e.g. a developer forgetting to scope a query) doesn't automatically become a cross-tenant data leak.
- Positive: scales to thousands of companies without connection-pool or migration-count blowup.
- Negative: every tenant-scoped Prisma model requires the `companyId` column and the RLS policy as boilerplate — mitigated by codifying this as a required part of the schema template/checklist (Phase 2 §22) rather than leaving it to be remembered per table.
- Negative: a very large single tenant shares infrastructure with everyone else — true physical isolation for a huge customer is a deliberate future feature, not automatic (Phase 2 §24, stated honestly).
- Required companion: an automated CI test suite that proves cross-tenant isolation for every table (Phase 2 §11.4) — this ADR is not considered fully satisfied without it.

## Alternatives considered
- **Schema-per-tenant**: rejected — migrations would need to run against thousands of schemas, and connection pooling degrades badly well before "thousands of companies."
- **Database-per-tenant**: rejected for the same reason, worse (thousands of separate DB instances to provision/patch/back up).
- **App-layer-only isolation (no RLS)**: rejected — a single missed `where companyId:` clause anywhere in the codebase becomes an active data breach; RLS is a second, independent line of defense that's cheap to add and directly closes that risk.
