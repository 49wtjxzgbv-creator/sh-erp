# SH ERP v2 — Phase 3: PostgreSQL Database Schema

Companion document to `prisma/schema.prisma` (48 models, verified — see §5). Covers what Prisma can't express declaratively (RLS policies), the rationale a raw schema file can't carry inline, the seed plan, and traceability back to Phase 1's 27-sheet inventory.

> **Revision note (2026-08-04):** a full architecture review against 9 criteria (normalization, indexes, relations, constraints, performance, Prisma/PostgreSQL best practices, multi-tenant security, scalability) was performed after this document's first version. It found and fixed several real gaps directly in `schema.prisma` — most notably 4 models with a `companyId` column but no actual FK to `Company`, 6 child tables with no `companyId` column at all (meaning the RLS template below couldn't be applied to them as written), and every `DateTime` field mapping to a timezone-naive Postgres type by default. Full findings, including open items awaiting a decision, are in **"SH ERP v2 — Phase 3 Architecture Review.md"**. §2 and §8 below are updated to reflect the fixes.
>
> **Second revision note (2026-08-04, same day):** the owner reviewed and approved all 5 open decisions from that review (detailed in **"SH ERP v2 — Phase 3 Open Decisions.md"**) — all Option A, plus the recommended hybrid for decision 5. All 5 are now applied directly to `schema.prisma`: (1) `Product.unit` is now `unitId`, a composite FK to `CompanyUnit`; (2) `CHECK` constraints for permanent BOM invariants, documented in the new §2b below; (3) `citext` is enabled (`postgresqlExtensions` preview feature) and applied to `Product.article`/`User.email`/`User.login`; (4) every REQUIRED relation between two tenant-scoped sibling models now uses a composite `(companyId, id)` foreign key — see the schema file's header comment for the one disclosed limitation (optional relations can't use this pattern, a real Prisma constraint); (5) every relation now carries an explicit `onDelete` policy (`Restrict` from `Company`, `Cascade` for pure child/expansion tables, `SetNull` for optional/soft references, implicit `Restrict` default left in place elsewhere and documented as such). §1, §2, §2b, §7, and §8 below are updated accordingly.
>
> **Third revision note (2026-08-04, same day):** Phase 4's migration engine design surfaced a gap — idempotent per-company reload keyed on `legacyId` needs a unique constraint that didn't exist yet. Owner approved adding `@@unique([companyId, legacyId])` to every migrated entity. Applied to all 13 tenant-scoped models that carry `legacyId` (`FileAsset`, `Product`, `Supplier`, `Warehouse`, `InventorySession`, `Assembly`, `ProductionOrder`, `FinishedGood`, `CustomerOrder`, `Shipment`, `PurchaseOrder`, `Employee`, `PayrollEntry`). Two documented exceptions, both because they don't fit the `[companyId, legacyId]` shape: `Company` itself has no `companyId` field (it IS the tenant root), so it gets a plain `@unique` on `legacyId` directly; `User` is global (not company-scoped — a person can belong to multiple companies), so a `[companyId, legacyId]` constraint isn't even expressible, and a bare global unique on `legacyId` would be actively wrong (two different companies' independent legacy spreadsheets could easily both have a local row id that collides) — `User.legacyId` stays unconstrained, with migration idempotency for `User` handled via `email` (already globally unique) instead. See §1 and §8 below. Phase 4 is now fully closed; Phase 5 begins after this revision.

---

## 1. Conventions (applied uniformly — see the schema file's own header comment for the short version)

- **Tenant scoping**: every tenant-scoped model has `companyId` as its first field after `id`, enforced at both the Postgres RLS layer and the Prisma application layer (ADR-0002).
- **Primary keys**: UUID everywhere, never sequential integers (Phase 2 §16 — partitioning/horizontal-scaling headroom, no row-count leakage).
- **Traceability**: `legacyId` (nullable) on every model that can originate from a Phase 4 migration.
- **Audit columns**: `createdAt`/`updatedAt` universally; `createdById`/`updatedById`-equivalents where "who" matters beyond what `AuditEvent` already captures.
- **Soft deletes**: `deletedAt` on models where deletion is a real, reversible user action (Product, Assembly, Supplier, Employee, Warehouse, CustomerOrder, PurchaseOrder-adjacent entities, Company itself).
- **Immutable ledgers**: `AuditEvent`, `StockMovement`, `AssemblyVersion`, `PayrollEntry`, `ProductionOrderStageEvent` are never soft-deleted or updated — no `deletedAt`/`updatedAt` at all, and the DB grants in §3 make this a real guarantee, not just an absent delete endpoint (the gap Phase 1 §10 flagged in the old `History` sheet's "guarantee by omission").
- **Money**: `Decimal @db.Decimal(14, 2)`, never `Float` — directly closes the class of bug behind the real Phase-1-documented production incident (§1.4/§10.8: Sheets Date-format corruption silently corrupting cost columns) by removing floating-point/spreadsheet-cell-format arithmetic entirely.
- **JSON-blob normalization**: all 5 of Phase 1's identified hidden-relational-data-in-a-cell columns are expanded into real tables (§4). The two remaining `Json` fields in the whole schema (`CompanySettings.dashboardWidgets`, `AuditEvent.metadata`) are deliberate, narrow exceptions — genuinely unstructured or genuinely-just-a-list data, not hidden entities, and called out as such in the schema file's comments.
- **Cross-tenant referential integrity** (decision 4, finalized): every REQUIRED relation between two tenant-scoped sibling models (e.g. `WarehouseStock` → `Product`) uses a composite foreign key — `fields: [companyId, xId], references: [companyId, id]` — instead of a plain `id`-only FK, making it structurally impossible for a row to reference another tenant's entity. 25 such composite relations exist in the schema; the 13 models that are a composite-FK target each carry an extra `@@unique([companyId, id])`. **Disclosed limitation**: Prisma requires every scalar field in an optional relation's `fields: [...]` to itself be optional, and `companyId` is never optional on a tenant-scoped model — so OPTIONAL cross-tenant relations (e.g. `Product.defaultSupplierId`, `AssemblyComponent.productId`) cannot use this pattern and remain single-column FKs, covered by the app-layer Prisma Client Extension (Phase 2 §11.4) instead of a DB-level guarantee. Each such field is marked `// single-column FK — see header §cross-tenant` in the schema.
- **Delete policy** (decision 5, finalized): every relation has an explicit `onDelete` — `Restrict` on all `company Company @relation` pointers (company removal is soft-delete-only, Phase 0), `Cascade` from a pure child/expansion table to its parent (e.g. `ProductionOrderPickListItem` → `ProductionOrder`), `SetNull` on optional/soft references (e.g. `Product.defaultSupplier`), and Prisma's implicit `Restrict` default left in place everywhere else — a lightweight, disclosed default posture, not a fully re-litigated policy for all 85 relations. Phase 5 confirms or overrides the default per module against real deletion UX.
- **Case-insensitive uniqueness** (decision 3, finalized): `Product.article`, `User.email`, and `User.login` use Postgres's `citext` type (via Prisma's `postgresqlExtensions` preview feature) instead of plain `text`, so `"ABC-100"` and `"abc-100"` correctly collide as the intended duplicate.
- **`Product.unit`** (decision 1, finalized): now a real foreign key (`unitId`) to `CompanyUnit`, composite per the cross-tenant rule above, instead of a free-text column — closes the gap where `CompanyUnit` existed as a lookup table but wasn't actually used by the one model that needed it most.
- **Idempotent migration reload** (Phase 4 §6, finalized): every migrated entity carries `@@unique([companyId, legacyId])`, so re-running the Phase 4 migration engine against the same source data upserts instead of duplicating. `Company` (the tenant root, no `companyId` field of its own) gets a plain `@unique` on `legacyId` instead. `User` (global, not company-scoped) is deliberately left unconstrained on `legacyId` — a bare global unique would incorrectly reject two different companies' independently-numbered legacy rows from colliding; migration idempotency for `User` uses `email` instead.

---

## 2. Row-Level Security

Prisma has no native RLS support — policies are applied via a raw-SQL migration (`prisma migrate dev --create-only`, then hand-edit the generated `.sql` file before applying), one policy per tenant-scoped table, following this exact template:

```sql
-- Example: products table. Repeated for every tenant-scoped table in the schema.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY; -- applies even to the table owner role, not just other roles

CREATE POLICY tenant_isolation ON products
  USING (company_id = current_setting('app.current_company_id', true)::uuid);
```

The application sets `app.current_company_id` once per request, at the start of the Prisma transaction, from the verified JWT claim (`TenantContextMiddleware`, Phase 2 §2.3):

```sql
SET LOCAL app.current_company_id = '...';
```

`SET LOCAL` (not `SET`) is deliberate — it scopes the setting to the current transaction only, so it can never leak across pooled connections between requests (a real risk with connection pooling if a plain `SET` were used and a connection were reused before being reset).

**Immutability grants** (§1's "DB-grant-enforced" claim, made concrete):
```sql
REVOKE UPDATE, DELETE ON audit_events, stock_movements, assembly_versions,
  payroll_entries, production_order_stage_events FROM app_user;
```
where `app_user` is the role the NestJS application connects as — so even a bug that somehow tried to update or delete an audit row would fail at the database, not just "happen not to" because no endpoint exists for it.

**Deployment requirement, made explicit after the architecture review**: `app_user` must not be a superuser and must not have `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` only blocks the table *owner's* connections from bypassing RLS — a superuser role bypasses RLS regardless of `FORCE`. This must be a checked item in the production database provisioning runbook, not an assumption.

Six child/expansion tables (`production_order_pick_list_items`, `production_order_stage_events`, `production_order_workers`, `assembly_version_components`, `qc_check_results`, `shipment_items`) originally had no `company_id` column, which meant this exact policy template couldn't be applied to them — they would have needed a slower, join-based policy against their parent table instead. All 6 now carry a denormalized `company_id` (set by the same Prisma Client Extension that injects it on every tenant write), so the same simple per-table policy applies uniformly across all tenant-scoped tables. See the Architecture Review doc for the full finding.

### 2c. Gap found during Phase 5 (Module 4 work) — pre-authentication lookups under RLS — APPROVED and implemented

Login, refresh-token rotation, and pre-login company discovery (`AuthService`) must read `users` (global, no RLS), `companies` (by slug), `company_memberships`, `refresh_tokens`, and `company_branding` — all BEFORE a tenant is known, since establishing the tenant is the point of these lookups. Under `FORCE ROW LEVEL SECURITY` with `app_user` correctly not having `BYPASSRLS` (§2 above), a connection that hasn't `SET LOCAL app.current_company_id` sees zero rows on any FORCE-RLS table — meaning these flows cannot function under the RLS policy exactly as originally documented in this section. This wasn't caught in Phase 3 because no code existed yet to exercise the login path against real RLS; it surfaced only once Phase 5 implementation actually built it.

**Approved resolution** (owner sign-off given explicitly; full rationale in **ADR-0009**, `docs/adr/0009-auth-service-bypassrls-role.md`): a second, narrowly-scoped database role, `auth_service`, used only by `AuthService`'s pre-tenant-context queries (login, refresh, and company discovery) — nothing else in the codebase touches it, and it must never be used once a tenant context has been resolved. Raw SQL (the authoritative version) is in `prisma/migrations/20260804000000_create_auth_service_role/migration.sql`:

```sql
CREATE ROLE auth_service LOGIN PASSWORD '...'; -- rotate before production
GRANT SELECT, UPDATE ON TABLE users TO auth_service;             -- UPDATE only for legacy-password-rehash
GRANT SELECT ON TABLE companies TO auth_service;
GRANT SELECT ON TABLE company_memberships TO auth_service;       -- read-only — login/refresh never write it
GRANT SELECT, INSERT, UPDATE ON TABLE refresh_tokens TO auth_service; -- issue/rotate/revoke; no DELETE
GRANT SELECT ON TABLE company_branding TO auth_service;          -- pre-login branding lookup only
ALTER ROLE auth_service BYPASSRLS;
```

`BYPASSRLS` here is narrower than it sounds: every query this role runs is already scoped by a value that uniquely identifies at most one relevant row on its own (email, tokenHash, or an explicit companyId+userId pair) — the "risk" RLS normally guards against (a request scoped to tenant A reading tenant B's rows) doesn't apply to a code path whose entire job is determining which tenant something belongs to. Table-level `GRANT`s (not `ALL`, no `DELETE` anywhere) bound the blast radius of this role regardless — see ADR-0009 for the full argument and the alternatives that were considered and rejected.

**Related gap, found and fixed while implementing this**: `CompanyService.createCompany` (company signup) had the identical underlying problem — it ran on the raw, non-transactional Prisma client with no `SET LOCAL` ever issued, so its writes to `company_memberships`/`company_settings` (and, via the per-module seeders, `roles`/`role_permissions`/`company_units`/`warehouses`) would have been rejected by Postgres the first time signup ran against real RLS. This did NOT need a new role — it needed `CompanyService` to actually use `PrismaService.runInTenantTransaction` (which already existed for exactly this, Phase 2 §11.4) with a client-generated `companyId`/`userId` known before the transaction opens. Fixed in `backend/src/modules/tenancy/company.service.ts`; not a schema or architecture change, a Module 1 implementation bug.

---

## 2b. Data integrity `CHECK` constraints (decision 2, finalized — permanent invariants only)

Prisma has no declarative `CHECK` attribute, so these are added the same way as the RLS policies above: hand-edited into the generated migration SQL after `prisma migrate dev --create-only`. Scoped deliberately narrow, per the owner's qualifier ("only for permanent business invariants") — broad constraints like non-negative quantities were explicitly *not* added, since a future backorder/negative-stock feature could legitimately need to violate that rule, and that's a product decision, not an architecture one.

```sql
-- AssemblyComponent: componentType must match which nullable FK is actually
-- set. This invariant is permanent — it's the row's own internal
-- consistency, not something a future feature would ever need to relax.
ALTER TABLE assembly_components ADD CONSTRAINT assembly_component_type_consistency
  CHECK (
    (component_type = 'PRODUCT'  AND product_id IS NOT NULL AND sub_assembly_id IS NULL) OR
    (component_type = 'ASSEMBLY' AND sub_assembly_id IS NOT NULL AND product_id IS NULL)
  );

-- Same invariant on the immutable BOM-version snapshot table.
ALTER TABLE assembly_version_components ADD CONSTRAINT assembly_version_component_type_consistency
  CHECK (
    (component_type = 'PRODUCT'  AND product_id IS NOT NULL AND sub_assembly_id IS NULL) OR
    (component_type = 'ASSEMBLY' AND sub_assembly_id IS NOT NULL AND product_id IS NULL)
  );

-- An assembly can never list itself as its own direct sub-assembly. This
-- catches only the single-row cycle case — full multi-level cycle detection
-- across the BOM graph is inherently an application-layer concern (Phase 5
-- BomModule), not something a CHECK constraint can express.
ALTER TABLE assembly_components ADD CONSTRAINT assembly_component_no_self_reference
  CHECK (assembly_id <> sub_assembly_id);
```

These three constraints must be re-added by hand to every future migration that touches these tables' structure, same operational discipline already required for the RLS policies — document this in the Phase 5 migration runbook.

---

## 3. Indexing rationale

- Every composite index leads with `companyId` (Phase 2 §11.3) — since virtually every query is tenant-scoped, this keeps indexes actually selective rather than redundant with RLS.
- Natural lookup indexes: `Product(companyId, article)` unique, `Product(companyId, name)`, `Product(companyId, category)`; `FinishedGood.serialNumber` globally unique (serials are already globally unique by construction in the old system's generator, and staying globally unique simplifies label/lookup UX even though the finished good itself is tenant-scoped via `companyId`).
- Status-filtered lists get a `(companyId, status)` composite index: `ProductionOrder`, `CustomerOrder`, `PurchaseOrder`, `Shipment`, `FinishedGood` — these are exactly the fields the old system's `list*(token, statusFilter)` functions filtered on (Phase 1 §3), so the new indexes target the query patterns that already exist.
- High-growth append-only tables (`AuditEvent`, `StockMovement`) get `(companyId, entityType, entityId)` and `(companyId, createdAt)` respectively — the two access patterns that matter for them ("show me this entity's history" and "show me recent activity") — and are the explicit partitioning-readiness candidates named in Phase 2 §16/§24 if/when a single company's volume ever justifies it.

---

## 4. JSON-blob expansion — direct mapping from Phase 1's findings

| Old Apps Script column (Phase 1 §2) | New table(s) |
|---|---|
| `ProductionOrders.PickListJson` | `production_order_pick_list_items` |
| `ProductionOrders.StageHistoryJson` | `production_order_stage_events` |
| `ProductionOrders.AssignedWorkersJson` | `production_order_workers` |
| `AssemblyVersions.ComponentsJson` | `assembly_version_components` |
| `QCChecks.ChecklistJson` | `qc_check_results` |

Every one of these is now a real table with typed columns, foreign keys, and indexes — queryable directly (e.g. "which employees worked which production orders this month" is now a join, not a `JSON.parse()` inside application code, Phase 1's documented pattern in `getPayrollSummaryReport`).

---

## 5. Full sheet-to-table coverage (Phase 1 §2 → Phase 3 schema, verified)

| Phase 1 sheet | Phase 3 table(s) |
|---|---|
| Users | `users`, `company_memberships`, `refresh_tokens` |
| Products | `products` |
| History | `audit_events` (general) + `stock_movements` (stock-specific, split out — §6) |
| Units | `company_units` |
| Settings | `company_settings` (+ `company_branding` split out for the branding-specific keys) |
| Assemblies | `assemblies` |
| AssemblyComponents | `assembly_components` |
| ProductionOrders | `production_orders` (+ 3 expansion tables, §4) |
| Warehouses | `warehouses` |
| WarehouseStock | `warehouse_stock` |
| PurchaseOrders | `purchase_orders` |
| PurchaseOrderItems | `purchase_order_items` |
| ProductionStages | `production_stages` |
| CustomerOrders | `customer_orders` |
| CustomerOrderItems | `customer_order_items` |
| FinishedGoods | `finished_goods` |
| AssemblyVersions | `assembly_versions` (+ 1 expansion table) |
| InventorySessions | `inventory_sessions` |
| InventoryItems | `inventory_items` |
| QCChecklist | `qc_checklist_items` |
| QCChecks | `qc_checks` (+ 1 expansion table) |
| Shipments | `shipments` |
| ShipmentItems | `shipment_items` |
| Employees | `employees` |
| PayrollEntries | `payroll_entries` |
| Suppliers | `suppliers` |
| TelegramUsers | *(not migrated — Telegram deprioritized per Phase 0; table intentionally absent, revisited when Telegram is rebuilt)* |

All 27 Phase 1 sheets are accounted for — 26 mapped forward, 1 (`TelegramUsers`) explicitly and deliberately deferred, not forgotten. New tables with no Phase 1 predecessor (`companies`, `roles`, `permissions`, `role_permissions`, `feature_flags`, `company_feature_flag_overrides`, `file_assets`, `company_ai_settings`, `pending_ai_actions`, `ai_usage_logs`, `plans`, `company_subscriptions`, `legacy_migration_runs`) are the genuinely new capability Phase 2 called for (multi-tenancy, flexible RBAC, feature flags, billing-readiness) — none of it existed to migrate from.

## 6. One deliberate split worth flagging explicitly

The old `History` sheet was one flat, free-text log for *everything* (stock moves, order status changes, QC results, production launches — Phase 1 §3.2's `logHistory_` was called from ~20 different places). The new schema deliberately splits this into two: `audit_events` (generic, cross-module, matches every action) and `stock_movements` (stock-quantity-specific, structured with real `productId`/`warehouseId`/signed-`qtyDelta` columns). This is a normalization decision, not a scope reduction — every old History row's information is still captured, just correctly typed depending on what kind of event it was, which is what makes real reporting queries (e.g. Phase 1's `getHistoryDerivedData_` "most used products" calculation) a straightforward indexed query instead of a full-sheet text scan.

---

## 7. Seed plan (Phase 5 implementation detail, planned now)

A `prisma/seed.ts` (written in Phase 5, not this phase) will, for every newly created company:
- Insert the fixed `Permission` catalogue (idempotent — same rows for every environment, not per-company).
- Create the 5 default `Role`s (Admin, Warehouse/Storekeeper, Production, Sales, Viewer — Phase 2 §6) with their `RolePermission` grants, `isSystem = true`.
- Create one default `Warehouse` (`isDefault = true`), mirroring `seedDefaultWarehouseIfEmpty_`.
- Seed default `CompanyUnit` rows (шт, уп, кг, м, рулон, комплект), mirroring `seedUnitsIfEmpty_`. **Must run before any `Product` row is created** — `Product.unitId` is now a required composite FK to `CompanyUnit` (decision 1), so a company's units have to exist first. The Phase 4 migration engine needs to respect this same ordering when loading legacy `Products` sheet rows: resolve/create the matching `CompanyUnit` row before inserting the `Product` row that references it.
- Seed default `ProductionStage` rows (Розкрій → Обробка → Зварювання/збірка → Фарбування → Пакування), mirroring `seedDefaultStagesIfEmpty_`.
- Seed default `QcChecklistItem` rows (the 5 generic checks), mirroring `seedDefaultQCChecklistIfEmpty_`.
- Create a `CompanySettings` row with `vatRatePercent = 20`, mirroring `seedVatRateIfEmpty_`.
- Create a `CompanyBranding` row (empty — populated when the owner uploads assets).

This is the same seeding *behavior* as `Setup.gs`'s `seed*IfEmpty_` functions (Phase 1 §1.4), now parameterized per new company at signup time instead of running once against a single global spreadsheet.

---

## 8. Verification performed on this schema

Prisma's own CLI (`prisma validate`) could not be run in this sandboxed environment — it requires downloading a schema-engine binary from `binaries.prisma.sh`, which this network sandbox blocks (403). This is disclosed rather than glossed over. In its place, a static structural check was run (Node script, not part of the deliverable, used only to verify this document):
- Brace balance: valid.
- 48 models, no duplicate model or table names.
- 68 explicit foreign-key relations, every one confirmed to have a matching opposite-side field on its target model (Prisma's hard requirement for explicit relations) — this caught and fixed 5 real missing-back-relation errors during drafting (on `Company`, `Warehouse`, `Product`, `Assembly`, and `CustomerOrderItem`) before this version.
- All 17 enums referenced in field types are declared.
- Every model has a valid primary key (`@id` on either `id` or, for 4 one-to-one company-config tables, on `companyId` itself).

**Second pass (architecture review, 2026-08-04)**: the same static checker was re-run after the 9-criteria review below. It caught a class of bug the first pass structurally could not see: 4 models (`FileAsset`, `PendingAiAction`, `AiUsageLog`, `LegacyMigrationRun`) had a `companyId` column that was never declared as an actual Prisma relation — the checker only validates relations that *are* declared, so a bare scalar column that merely looks like it should be a foreign key is invisible to it. All 4 were fixed by adding the missing `company Company @relation(...)` field. After all Phase 3 review fixes: brace balance OK, 48 models (unchanged), 0 duplicate names, 73 owning-side relations all with a matching opposite side, 17 enums all declared and referenced correctly, every model has a valid primary key, and (new check added this pass) 0 `DateTime` fields remaining without an explicit `@db.Timestamptz(3)` native type.

**Third pass (5 finalized decisions applied, 2026-08-04, same day)**: the checker was extended with a new check — for every composite (multi-field) relation, confirm the target model actually carries a matching `@@unique([companyId, id])` — and re-run after all 5 decisions were applied. Results: brace balance OK, 48 models (unchanged), 0 duplicate names, **85 owning-side relations** (up from 73 — the new `Product.unit` relation plus splitting some previously-single-field relations into explicit `company` + sibling-entity pairs), all with a matching opposite side, **25 composite (multi-field) relations, all 25 with a matching `@@unique([companyId, id])` target** confirmed, 17 enums all declared and referenced correctly, every model has a valid primary key, 0 `DateTime` fields without `Timestamptz`, 65 relations now carry an explicit `onDelete` policy, 3 fields use `@db.Citext`. Full findings in **"SH ERP v2 — Phase 3 Architecture Review.md"** and **"SH ERP v2 — Phase 3 Open Decisions.md"**.

**Fourth pass (Phase 4 idempotency constraint, 2026-08-04, same day)**: `@@unique([companyId, legacyId])` added to the 13 tenant-scoped models that carry `legacyId`, plus the `Company`/`User` exceptions documented in §1. Re-run: brace balance OK, 48 models (unchanged), 0 duplicates, 85 owning-side relations all with opposite sides, 25/25 composite relations with valid targets, every model has a PK, and (new check added this pass) all 13 expected `@@unique([companyId, legacyId])` constraints confirmed present, `Company.legacyId` confirmed as a plain unique, `User.legacyId` confirmed intentionally unconstrained.

**Recommended before Phase 5 implementation begins**: run `prisma validate` and `prisma migrate dev` for real, against a real Postgres instance, in an environment with normal network access (any real developer machine or CI) — this static check increases confidence but is not a substitute for the actual Prisma engine's validation. This recommendation is unchanged and still outstanding, and is now more important than before: composite foreign keys, the `citext`/`postgresqlExtensions` preview feature, and explicit `onDelete` policies are all real syntax the static checker approximates but cannot fully guarantee compiles to valid Postgres DDL. This should be the first thing done once Phase 5 has normal network access, before writing any application code against this schema.
