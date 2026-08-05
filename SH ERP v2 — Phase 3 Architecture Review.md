# SH ERP v2 — Phase 3: Architecture Review

Full re-review of `prisma/schema.prisma` (48 models) and the Phase 3 companion doc, against the 9 categories requested: normalization, missing indexes, incorrect relations, missing constraints, performance, Prisma best practices, PostgreSQL best practices, multi-tenant security, scalability.

Each finding is marked **[FIXED]** (already applied directly to `schema.prisma`, since it was an unambiguous bug/gap with no real tradeoff) or **[OPEN — needs your decision]** (a real tradeoff, or a change too large to make silently).

---

## Headline finding: 4 models had `companyId` but no actual foreign key to `Company`

`FileAsset`, `PendingAiAction`, `AiUsageLog`, and `LegacyMigrationRun` each declared `companyId String @db.Uuid` as a bare scalar — never wired as `company Company @relation(...)`. This is the most important bug in the schema: it means those 4 tables had **no referential integrity to `companies.id` at all**, and — more importantly — the Phase 3 RLS policy template (`USING (company_id = current_setting(...))`) still works on a bare column, but there was no database-level guarantee that `companyId` even pointed at a real company.

This also explains why the earlier static structural check (5 bugs found and fixed during initial drafting) didn't catch it: that check only validates relations that *are* declared — a column that merely looks like it should be a relation, but isn't declared as one, is invisible to it. Worth remembering as a limitation of static checking in general, not just this checker.

**[FIXED]** — added the missing `company Company @relation(fields: [companyId], references: [id])` to all 4 models, and the 4 corresponding back-relation arrays on `Company`.

---

## 1. Normalization

- **`Product` has 6 overlapping free-text classification columns** (`category`, `productGroup`, `family`, `type`, `kind`, `productLine`), none of them foreign keys to a lookup table — unlike `unit`, which also isn't an FK to `CompanyUnit` despite `CompanyUnit` existing as a dedicated lookup model. As free text, two products meant to share a category can silently diverge ("Кабель" vs "кабель"), and nothing stops filtering/reporting UI from fragmenting. **[OPEN]** — this mirrors the old system's own columns exactly (Phase 1 data dictionary), so per "preserve all business logic" I did not restructure it unilaterally. Two real options: (a) leave as free text for Phase 5, add normalization later once real usage data shows which of these 6 fields actually matter; (b) make `Product.unit` an FK to `CompanyUnit` now, since that lookup table already exists and the mismatch looks like an oversight rather than intentional legacy preservation. I'd recommend (b) specifically — it's a 2-line change — and leave (a) for a product decision, not an architecture one.
- **Price fields store both excl-VAT and incl-VAT** (`localPriceExclVat`/`localPriceInclVat`, `germanPriceExclVat`/`germanPriceInclVat`) with no DB-level tie to `CompanySettings.vatRatePercent`. If a company's VAT rate changes, previously-stored incl-VAT prices go stale relative to the new rate with nothing flagging the drift. This matches the old system's behavior (Phase 1), so preserved as-is, but worth flagging: Phase 5's pricing service should treat excl-VAT as the source of truth and compute incl-VAT on read/write rather than trusting both columns to stay in sync forever. **[OPEN — implementation-level note, not a schema change.]**

## 2. Missing indexes

**[FIXED]** — added:
- `Product`: `@@index([companyId, barcode])` — barcode scanning is a real lookup path (Phase 1) and had no index.
- `FinishedGood`: `@@index([customerOrderId])` and `@@index([consumedInProductionOrderId])` — both are FK lookup paths ("finished goods for this order", FIFO sub-assembly consumption tracing) with no index before.
- `PurchaseOrderItem`, `CustomerOrderItem`: `@@index([companyId])` — previously only indexed via their parent order's ID, meaning a direct tenant-wide query on line items had no usable index. `CustomerOrderItem` also got `@@index([assemblyId])` ("which orders use this assembly" is a real report).
- `RefreshToken`: `@@index([expiresAt])` — the token-cleanup job (purge expired/revoked tokens) had nothing to scan by.

**[OPEN]** — at real scale, consider partial indexes (`WHERE deleted_at IS NULL`) on the soft-deletable tables (`Product`, `Assembly`, `Supplier`, etc.) so the common "active rows only" query path doesn't pay for dead-row visibility checks against a full index. Prisma's schema DSL can't express a partial index directly — this needs a hand-edited raw-SQL migration, same mechanism already used for RLS policies. Not applied now since it's premature at current data volume; flagging as a documented follow-up for when real query plans justify it.

## 3. Incorrect relations

**No structurally incorrect relations found** (the earlier bug was a *missing* relation, not an incorrect one — covered above). One relation worth double-checking at implementation time: `Assembly.componentOfParents AssemblyComponent[] @relation("SubAssembly")` — the name is easy to misread; it's "the `AssemblyComponent` rows where *this* assembly is used as someone else's sub-component," not "components of this assembly's parent." Purely a naming/readability note, not a bug — flagging so it doesn't trip up whoever writes the BOM service in Phase 5.

## 4. Missing constraints

**[FIXED]**:
- `ProductionOrderWorker` had no constraint preventing the same employee being listed twice on one order. Added `@@unique([productionOrderId, employeeId])`.
- `WarehouseStock`'s unique constraint was `[productId, warehouseId]` without `companyId` in the key. Changed to `@@unique([companyId, productId, warehouseId])` for consistency with the "every tenant-scoped model" convention, and it now doubles as the tenant-lookup index (removed the separate redundant `@@index([companyId])`).

**[OPEN — needs a raw-SQL migration, can't be expressed in `schema.prisma` itself]**:
- No non-negative CHECK constraints on quantity columns (`Product.qty`, `PurchaseOrderItem.qtyOrdered`/`qtyReceived`, `AssemblyComponent.qtyPerUnit`, etc.). Prisma has no `@check` attribute — these would need to be added by hand-editing the generated migration SQL, the same pattern already used for RLS and the immutability `REVOKE` grants. Recommend adding at least `CHECK (qty >= 0)`-style constraints on the ledger-adjacent tables before Phase 5, since a single application bug could otherwise write negative stock with nothing at the DB layer to catch it.
- `AssemblyComponent` and `AssemblyVersionComponent` have no constraint enforcing "if `componentType = PRODUCT` then `productId` is set and `subAssemblyId` is null, and vice versa" — currently only an application-layer invariant. A `CHECK` constraint would make this a real guarantee. Also worth a `CHECK (assemblyId <> subAssemblyId)` on `AssemblyComponent` to block a component from listing itself as its own sub-assembly at the DB layer (full multi-level cycle detection still has to be application logic — that's inherent to any graph stored relationally, not fixable with a CHECK).
- `Product.article` is documented as "unique business key, case-insensitive within a company" but the actual unique index (`@@unique([companyId, article])`) is case-sensitive — `"ABC-1"` and `"abc-1"` would both pass today. Same applies to `User.email`. Real fix is the Postgres `citext` extension (or a generated lowercase shadow column), which requires enabling Prisma's `postgresqlExtensions` preview feature — a generator-level change with broader implications, so I flagged it rather than silently enabling a preview feature. Recommend enabling it before Phase 5, since this is a genuine data-integrity gap, not cosmetic.

## 5. Performance

- **[FIXED — see indexes above]**, the missing FK-lookup indexes were the concrete performance gaps.
- `WarehouseStock` rows are updated on every stock movement — the same (product, warehouse) row will see concurrent writes from concurrent orders/production consumption. This is an application-layer concern (needs `SELECT … FOR UPDATE` or an atomic `UPDATE … SET qty = qty + delta` rather than read-then-write), not a schema defect, but worth flagging now so Phase 5's `InventoryModule` design accounts for it from the start rather than discovering it under load.
- Recursive BOM cost/shortage queries (`AssemblyComponent.subAssemblyId` self-reference) can't be expressed through Prisma's query builder — they need a raw recursive CTE (`$queryRaw`). This was already implied by the schema's own comment but is worth stating explicitly as a Phase 5 planning note: budget for hand-written SQL in `BomModule`, not just Prisma Client calls.
- No full-text/trigram search index on `Product.name`/`article` for autocomplete-style search. Not applied now (needs the `pg_trgm` extension, same preview-feature consideration as `citext` above) — flagged as a Phase 5+ nice-to-have once product-catalog search UX is actually being built, not a Phase 3 blocker.

## 6. Prisma best practices

- **No relation carried an explicit `onDelete`/`onUpdate` policy anywhere in the original schema** — all 70+ relations relied on Prisma's implicit defaults. This is a real gap: for a schema built on soft-deletes (`deletedAt`) coexisting with hard FK constraints, the delete behavior at each relation should be a deliberate, documented choice (e.g. `Restrict` from `Company` downward, since company deletion is soft-delete-only per policy; `Cascade` from `ProductionOrder` to its pick-list/stage-event/worker child rows, since those only exist in the context of their parent) rather than whatever Prisma's default happens to resolve to. **[OPEN]** — this touches every relation in the file, so I didn't apply it blindly; it needs a short pass in Phase 5 deciding cascade behavior model-by-model against real deletion workflows, and is worth its own short ADR once decided.
- **[FIXED]** — the 4 missing `Company` relations (headline finding) and the resulting inconsistency in the "every tenant-scoped model has a `companyId` relation" convention.
- **[FIXED]** — 6 child/expansion tables (`ProductionOrderPickListItem`, `ProductionOrderStageEvent`, `ProductionOrderWorker`, `AssemblyVersionComponent`, `QcCheckResult`, `ShipmentItem`) had no `companyId` column at all, only reachable via a join to their parent. Added `companyId` (denormalized from the parent at write time, same as every other tenant-scoped table) plus an index, to each. This was also a Prisma-convention violation — the schema's own header comment states "every tenant-scoped model has `companyId` as its first field," and these 6 silently didn't.
- Inconsistent audit columns: `WarehouseStock`, `CompanyFeatureFlagOverride`, `CompanySettings`, `CompanyBranding`, `CompanyAiSettings` had `updatedAt` but no `createdAt`, against the schema's own stated "createdAt/updatedAt universally" convention. **[FIXED]** — added `createdAt` to all 5.

## 7. PostgreSQL best practices

- **Every `DateTime` field mapped to Postgres `timestamp(3)` (no timezone) by default** — Prisma's default PostgreSQL mapping for `DateTime` without an explicit native type is timezone-naive. For a multi-tenant SaaS where `Company.timezone` already varies per tenant, storing naive timestamps is a real correctness risk (ambiguous DST transitions, off-by-timezone bugs in any report crossing a day boundary). **[FIXED]** — added `@db.Timestamptz(3)` to all 66 `DateTime` fields in the schema, schema-wide, mechanically. This is arguably the single highest-value fix in this review, since it would have been a very easy bug to ship silently and only notice once cross-timezone customers started filing confusing date-off-by-one reports.
- `FORCE ROW LEVEL SECURITY` is already specified in the companion doc's RLS template — correct, since without `FORCE` a table owner's own connections bypass RLS. One thing the companion doc doesn't yet say explicitly: the application's DB role (`app_user`) **must not** be a superuser or have `BYPASSRLS`, or the whole RLS layer is silently inert. Added as an explicit deployment requirement in the companion doc's revision note (§9 below) rather than assumed.
- No use of `citext` for case-insensitive uniqueness (`article`, `email`) — covered under Missing Constraints above, same fix, listed once.

## 8. Multi-tenant security

This is where the two biggest structural findings live:

1. **[FIXED]** 6 tables had no `companyId` column (see Prisma-best-practices section above) — meaning the Phase 3 companion doc's own RLS template ("one policy per tenant-scoped table, `USING (company_id = current_setting(...))`") **could not actually be applied to those 6 tables as written**, since there was no `company_id` column to filter on. They would have needed a slower, join-based policy (`EXISTS (SELECT 1 FROM production_orders WHERE id = production_order_id AND company_id = current_setting(...))`), which is both a performance regression and an inconsistency with every other table's policy shape. Adding the denormalized `companyId` column (set by the same Prisma Client Extension that already injects it elsewhere, per Phase 2 §11.4) fixes both problems at once.

2. **[OPEN — the more structurally significant one]** Nothing in the schema stops a same-tenant row from pointing at a *different* tenant's related entity. Standard Postgres foreign keys only check "does this ID exist," not "does this ID belong to the same company as the referencing row." Concretely: nothing in the DB prevents a `WarehouseStock` row for Company A's warehouse from referencing a `Product` that actually belongs to Company B — RLS protects which *rows* a request can see/touch, but it doesn't validate cross-table consistency of the `companyId` values inside the rows a tenant is legitimately allowed to write. Today the only guard against this is the app-layer Prisma Client Extension (Phase 2 §11.4). Two real options, with a real tradeoff between them:
   - **DB-enforced**: use composite foreign keys — e.g. `WarehouseStock` would reference `Product(companyId, id)` instead of just `Product(id)`, via a composite unique index on `Product(companyId, id)`. This makes cross-tenant references physically impossible at the database layer, at the cost of a meaningfully larger schema change (every tenant-scoped relation gets an extra column in its FK) and slightly larger indexes.
   - **App-enforced only** (current state): keep single-column FKs, rely on the Prisma Client Extension to validate `companyId` consistency on every write that links two tenant-scoped entities, backed by a periodic reconciliation job that scans for any FK pair with mismatched `companyId` (belt-and-suspenders against an app-layer bug slipping through).

   Given "design for thousands of companies" and this being a commercial product, I'd lean toward recommending the composite-FK approach for the highest-risk links specifically (`Product`↔`Warehouse`-adjacent tables, since inventory-quantity corruption is the worst failure mode) rather than schema-wide — but this is a real architectural tradeoff, not a bug fix, so I did not apply it and am surfacing it for your decision before Phase 4.

## 9. Scalability

- Global uniqueness (`FinishedGood.serialNumber`, `User.email`/`login`, `Permission.key`, `FeatureFlag.key`, `Plan.key`) is not partitioned by company — technically fine at "millions of rows" (B-tree indexes handle that comfortably), flagged only as a thing to watch, not a defect.
- `AuditEvent`/`StockMovement` remain the named partitioning candidates (already called out in Phase 2 §16/§24 and the companion doc) — no change needed now, this review doesn't add anything new here beyond confirming the existing plan still makes sense.
- Recursive BOM walk performance at scale depends entirely on Phase 5 writing an efficient recursive CTE rather than N+1-ing through Prisma — already covered under Performance above, repeating here only because it's also a scalability concern once assembly graphs get deep.

---

## Summary of changes applied directly to `schema.prisma`

1. Added the 4 missing `Company` relations (`FileAsset`, `PendingAiAction`, `AiUsageLog`, `LegacyMigrationRun`) + back-relation arrays on `Company`.
2. Added `companyId` (+ relation context + index) to 6 previously tenant-column-less child tables.
3. Added `@@unique([productionOrderId, employeeId])` on `ProductionOrderWorker`.
4. Changed `WarehouseStock`'s unique constraint to include `companyId`.
5. Added indexes: `Product(companyId, barcode)`, `FinishedGood.customerOrderId`, `FinishedGood.consumedInProductionOrderId`, `PurchaseOrderItem.companyId`, `CustomerOrderItem.companyId`, `CustomerOrderItem.assemblyId`, `RefreshToken.expiresAt`.
6. Added `createdAt` to 5 config/join tables that only had `updatedAt`.
7. Added `@db.Timestamptz(3)` to all 66 `DateTime` fields schema-wide.

Re-ran the same static structural checker used during initial Phase 3 drafting after all changes: brace balance OK, 48 models (unchanged), 0 duplicate model/table names, 73 explicit owning-side relations all with a matching opposite side, 17 enums all declared and referenced correctly, every model has a valid primary key, 0 `DateTime` fields remaining without `Timestamptz`.

**Still not done, same caveat as Phase 3 itself**: this is still a static check, not the real `prisma validate`/`prisma migrate dev` — that remains blocked in this sandbox (403 from `binaries.prisma.sh`) and still needs to run for real before Phase 5.

## Open decisions before Phase 4, for you

1. Make `Product.unit` an FK to `CompanyUnit` now, or leave as free text? (recommended: FK now, it's a 2-line change and the lookup table already exists)
2. Add non-negative / componentType-consistency CHECK constraints via raw-SQL migration edit, same mechanism as RLS? (recommended: yes, before Phase 5)
3. Enable Prisma's `postgresqlExtensions` preview feature for `citext` (case-insensitive `article`/`email`)? (recommended: yes — it's the correct fix for a documented-but-unenforced invariant)
4. Composite foreign keys for cross-tenant referential integrity — schema-wide, targeted at the highest-risk links only, or deferred entirely in favor of the existing app-layer + reconciliation-job approach? (this is the one genuine architecture-level tradeoff in this review — no default recommendation, wanted your call before touching it)
5. Explicit `onDelete`/`onUpdate` policy per relation — planned as a Phase 5 pass once real deletion workflows are designed, or worth doing now against the current schema?
