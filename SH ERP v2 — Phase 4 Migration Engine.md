# SH ERP v2 — Phase 4: Migration Engine

Design for the Google Sheets → PostgreSQL migration pipeline. Per Phase 0's freeze-and-switch decision, this phase produces a dry-run-tested pipeline only — the real cutover run happens later, per company, when its owner is ready to freeze that company's live Apps Script deployment. No production code is written yet; this is the design, matching the discipline used for Phases 1-3.

---

## 1. Scope and unit of migration

The old system is one Apps Script deployment + one Google Sheet per customer (Phase 1). The new system is multi-tenant from day one (Phase 0). So migration is inherently **per-company**: each legacy deployment becomes exactly one `Company` row plus all of that company's data, run once at that company's own cutover moment — not a single big-bang migration of "the system," since there is no single old system, there are N independent old deployments (today, one; more as other companies onboard, per the Phase 0 note that other companies are already lined up).

This means the migration engine is a **repeatable, per-company tool**, not a one-off script: `migrate-company --source-sheet-id <id> --company-slug <slug> [--dry-run]`. Same code path runs the first real cutover and every subsequent customer's onboarding migration.

## 2. Pipeline shape: five stages

Mirrors the reconciliation lifecycle already modeled in `LegacyMigrationRun.status` (`EXTRACTING → TRANSFORMING → LOADING → VERIFYING → COMPLETED | FAILED`).

### 2.1 Extract

Pull every one of Phase 1's 26 migratable sheets (27 minus `TelegramUsers`, deferred per Phase 0) via the Google Sheets API (not by re-running Apps Script code — the migration tool is a standalone Node/TypeScript CLI, decoupled from the legacy runtime it's replacing) into a local staging snapshot: one JSON file per sheet, raw rows, no transformation yet. This snapshot is saved to disk (or R2) and timestamped — it's the immutable "what we actually read" record, so a transform bug can be fixed and re-run against the same extracted data without re-reading the source spreadsheet (which may have kept changing if extract and cutover aren't the same instant).

Extract is read-only against the source — it never writes back to the Google Sheet.

### 2.2 Transform

The bulk of the design work. Converts each sheet's raw rows into typed, Prisma-shaped records, entirely in memory / against the local snapshot, before anything touches Postgres. Sub-steps, in dependency order (this order matters — later steps reference IDs assigned in earlier ones):

1. **Company row.** One `Company` created first (or reused, if this is a re-run against an already-started migration), from operator-supplied metadata (name, slug, timezone, locale) — not derived from sheet data, since the old system has no `Company` concept at all.
2. **Seed data**, same shape as `prisma/seed.ts` (Phase 3 §7): default `Role`/`RolePermission`, default `Warehouse` (`isDefault = true`), default `ProductionStage`s, default `QcChecklistItem`s, a `CompanySettings` row. Crucially — **and this is a new ordering requirement from decision 1** — `CompanyUnit` rows must be created and resolved to real ids at this step too, since `Product.unitId` is now a required composite FK. Every distinct unit string used across the legacy `Products` sheet (not just the 6 seeded defaults) must be resolved to a `CompanyUnit` row before any `Product` row can be built — if a legacy product uses a unit string not in the default seed list, the transform step creates an ad hoc `CompanyUnit` row for it rather than failing or silently coercing it to a default.
3. **Reference/lookup entities**: `Supplier`, `Employee`, `ProductionStage` (if not already covered by seed), each getting a fresh UUID with `legacyId` set to the old sheet row's identifier.
4. **`Product`** — the largest single mapping. Old columns map mostly 1:1 onto typed columns (Phase 3's `Product` model already carries every legacy field verbatim, per "preserve all business logic"). Two non-trivial parts: `unitId` resolution against the table built in step 2, and `defaultSupplierId` resolution against step 3's `Supplier` id map (by name match — logged, not silently dropped, if no confident match exists, mirroring the `PurchaseOrder.supplierNameSnapshot` free-text-preserved pattern already in the schema).
5. **`Assembly`, `AssemblyComponent`, `AssemblyVersion`, `AssemblyVersionComponent`** — the BOM tree. `AssemblyVersion`/`AssemblyVersionComponent` are built from the old `AssemblyVersions.ComponentsJson` blob (Phase 3 §4's mapping table) — this is a real `JSON.parse()` on the old data, one of the few places transform does semantic blob-parsing rather than column renaming. Componenttype/productId/subAssemblyId consistency (now DB-enforced via the decision-2 `CHECK` constraints) must hold coming out of transform, or the load step will reject the row — transform should validate this itself first and report it as a data-quality warning rather than letting it fail opaquely at load time.
6. **`Warehouse`, `WarehouseStock`** — including materializing the old implicit "default warehouse remainder" into a real row (Phase 1 §6.6, already flagged in Phase 3's schema comments: "a view, not a ledger" in the old system). This is a computed value (total product qty minus sum of all named warehouses' explicit stock), not a column that exists in the source data — transform must compute it, and it's one of the two "verify" checks (§4) with the highest chance of a silent off-by-something bug, so it gets explicit reconciliation.
7. **`ProductionOrder` + its 3 expansion tables** (`ProductionOrderPickListItem`, `ProductionOrderStageEvent`, `ProductionOrderWorker`) — parsed from `PickListJson`/`StageHistoryJson`/`AssignedWorkersJson` respectively (Phase 3 §4). `assemblyVersionId` on old rows predating BOM versioning is left null, matching the schema's own documented nullable-for-legacy-rows note.
8. **`FinishedGood`, `QcCheck`, `QcCheckResult`** (the last parsed from `ChecklistJson`), **`CustomerOrder`, `CustomerOrderItem`, `Shipment`, `ShipmentItem`, `PurchaseOrder`, `PurchaseOrderItem`, `PayrollEntry`** — remaining sheets, all straightforward 1:1 column mapping at this point since every referenced entity already has a resolved new-UUID by this step.
9. **`StockMovement` and `AuditEvent`** — built from the old `History` sheet, split per Phase 3 §6's documented rule: stock-quantity-affecting rows become `StockMovement`, everything else becomes `AuditEvent`. This is a per-row classification step (pattern-matching the old free-text history entries against the small set of known action types), and is explicitly allowed to be imperfect at the margins — anything that doesn't clearly classify falls through to `AuditEvent` with the original text preserved in `metadata`, never dropped.

Every entity created in transform gets `legacyId` set to its source row's stable identifier (Phase 1's per-sheet ID/serial columns). This is the mechanism that makes load idempotent (§2.3) and is also the backbone of the row-count and spot-check reconciliation in §2.4.

### 2.3 Load

Writes the transformed, in-memory object graph to Postgres via Prisma, inside a **single database transaction per company migration run** where the target database can support it (Postgres has no hard row-count limit on a transaction; at the "current data volume is small" scale confirmed in Phase 0, a whole company's data fits comfortably in one transaction). This gives an all-or-nothing guarantee for free — a failure at row 40,000 rolls back everything, rather than leaving a half-migrated company live.

Two load-ordering rules, both consequences of decisions made in the Phase 3 review:
- **Respect the composite-FK dependency order** from §2.2's transform sequence — a composite FK (decision 4) fails at the database level if the referenced `(companyId, id)` row doesn't exist yet, so load order isn't optional, it's enforced by the schema itself now. This is actually a safety net gained from decision 4: if transform's dependency ordering has a bug, load fails loudly with a real FK violation instead of silently succeeding with a dangling reference.
- **Idempotent by `legacyId`**: load uses `upsert` keyed on `(companyId, legacyId)` (needs a new `@@unique([companyId, legacyId])` per applicable model — not yet in the schema, flagged as a small Phase 4 schema addition, see §6) rather than plain `create`, so a re-run after a partial failure doesn't duplicate rows already written in a prior attempt.

Every run writes a `LegacyMigrationRun` row (already modeled in Phase 3) tracking `status`, `sourceDeploymentId`, and — filled in by §2.4 — `reconciliationReport`.

### 2.4 Verify

Runs automatically at the end of every load, dry-run or real, and populates `LegacyMigrationRun.reconciliationReport`:

- **Row counts**: source sheet row count vs. new table row count, per the Phase 3 §5 sheet-to-table mapping (accounting for the expansion tables — one old `ProductionOrders` row legitimately becomes 1 + N rows across 4 tables, so the check is "does the count relationship match what transform's own logic predicts," not a naive 1:1 assertion).
- **Sum checks**: total product quantity (sum of `WarehouseStock.qty` per product, across all warehouses including the materialized default-warehouse remainder from §2.2 step 6) must equal the old `Products.Qty` value it was computed from — this is the single most important reconciliation check, since a stock-quantity bug is the worst possible migration failure for a warehouse-management product.
- **Referential completeness**: every `legacyId`-tagged row's cross-references resolved to a real target (no "supplier not found, left null" case exceeds an operator-reviewable threshold — Phase 3 already documents this "flag the rest" pattern for suppliers and products with no confident match).
- **Spot-check sampling**: N random rows per table, full field-by-field diff against the source sheet row, surfaced in the report for human review — catches transformation bugs that count/sum checks can't (e.g. a systematically-off-by-one date, correct count and correct sum, but wrong actual values).

`reconciliationReport` is a `Json` field by design (Phase 3) — its shape isn't fixed in the schema because what's worth reporting will evolve as real migrations surface real issues; a rigid typed report would need a schema migration every time the checklist grows.

### 2.5 Dry-run vs. real cutover

`--dry-run` runs all four stages above against a **separate, disposable Postgres database** (a throwaway schema or a scratch instance — not a "transaction that gets rolled back" against the real production database, since RLS policies, `CHECK` constraints, and the immutability `REVOKE` grants should all be exercised for real during a dry run, not skipped). Output is the same `LegacyMigrationRun` + `reconciliationReport` shape as a real run, so the operator reviews the exact same report before and after flipping to a real cutover.

A real (non-dry-run) migration is a manual, single-operator action taken at a specific company's agreed cutover moment (Phase 0's freeze-and-switch: the company's Apps Script deployment is frozen — read-only or fully disabled — for the duration of one migration run, then traffic switches to the new system once `VERIFYING` passes). This phase does not build any automation for triggering that moment; it's a deliberate, human-initiated action per company, not a scheduled job.

## 3. What Phase 4 does NOT include

- **No automatic/scheduled migrations.** Every company's cutover is a manual, reviewed action.
- **No live dual-write or parallel-run.** Phase 0 explicitly chose freeze-and-switch over a parallel-run strategy — the old system is frozen, not kept in sync.
- **No UI.** The migration engine is a CLI tool for the operator (today, that's the owner directly); a Phase 5+ admin UI for self-serve customer onboarding migrations is out of scope here.
- **No `TelegramUsers` migration** — deferred per Phase 0, consistent with Phase 3's sheet-coverage table.
- **No automatic rollback-after-cutover.** Once a company has switched over and started writing new data in the new system, "rollback" would mean reconciling new writes back into the old spreadsheet, which is out of scope — the safety net is entirely pre-cutover (dry runs, the transaction-wrapped load, verify-before-switch), not post-cutover.

## 4. Error handling and partial-failure posture

- A failed `LOADING` stage rolls back the whole transaction (§2.3) — the company's target data is left exactly as it was before the run started (empty, for a first attempt), never half-populated.
- A failed `VERIFYING` stage does **not** roll back the load — the data is there, but `LegacyMigrationRun.status = FAILED` and the reconciliation report explains why, so an operator can inspect the actual loaded data against the report before deciding whether to fix and re-run (idempotent via `legacyId`, §2.3) or investigate further. This is a deliberate asymmetry: a load failure is unambiguous (the transaction didn't commit), but a verify failure needs human judgment (is this a real data problem, or a false positive in the reconciliation logic itself?).
- Extract and transform failures are the cheapest to recover from — nothing has touched Postgres yet — and simply abort with a clear error pointing at the offending sheet/row.

## 5. Reuse from Phase 3

The migration engine is a **consumer** of the Phase 3 schema, not a redesign of it — every mapping in this document points back to Phase 3 §4 (JSON-blob expansion) and §5 (sheet-to-table coverage), which don't change here. The composite-FK and `CHECK`-constraint work from the 5 finalized decisions directly benefits this phase: they turn a class of migration bug (a transform step accidentally wiring one company's data to another's, or an inconsistent BOM row) from "silently wrong data" into "the load step fails loudly," which is exactly the failure mode you want during a migration dry run.

## 6. Small schema addition needed for idempotent load

One gap surfaced by this design that Phase 3's schema doesn't yet cover: idempotent `upsert`-by-`legacyId` load (§2.3) needs `@@unique([companyId, legacyId])` on every model that carries a `legacyId` field (currently `legacyId` exists but isn't part of any unique constraint anywhere in the schema). This is a small, mechanical addition — flagging it here rather than applying it silently, since it's a Phase 3 schema change being requested from Phase 4, and the same "re-verify after any schema touch" discipline used throughout Phase 3 should apply.

---

## §6 resolved (2026-08-04)

Approved and applied. `@@unique([companyId, legacyId])` now exists on all 13 tenant-scoped models that carry `legacyId` (`FileAsset`, `Product`, `Supplier`, `Warehouse`, `InventorySession`, `Assembly`, `ProductionOrder`, `FinishedGood`, `CustomerOrder`, `Shipment`, `PurchaseOrder`, `Employee`, `PayrollEntry`). Two exceptions surfaced during implementation and are documented in `schema.prisma`'s own field comments and in database-schema.md §1: `Company` (no `companyId` field — it's the tenant root) gets a plain `@unique` on `legacyId`; `User` (global, not company-scoped) is deliberately left unconstrained, since a bare global unique would incorrectly reject two different companies' independently-numbered legacy rows — `email` (already globally unique) is the idempotency key for `User` load instead. Re-verified with the extended static checker: all 13 constraints present, `Company`/`User` exceptions confirmed as intentional, no regressions elsewhere (48 models, 85 relations, 25/25 composite targets valid). Phase 4 is closed; Phase 5 begins next.
