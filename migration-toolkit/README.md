# SH ERP v2 — Legacy Data Migration Toolkit

Turns the "SH ERP v2 — Phase 4 Migration Engine.md" DESIGN (an earlier
session, design-only, no code) into a real, runnable Node/TypeScript CLI.
Built during the production-readiness pass, after all 12 backend modules,
all 12 frontend tasks, and the 4 owner-prioritized secondary features
(Users/Roles/Audit, Excel import/export, doc/label printing, spreadsheet
grid, AI voice mode) were already shipped.

Same 5-stage pipeline the design doc specifies — **extract → transform →
load → verify → dry-run** — run **per company** (the old system is one
Apps Script deployment per customer; the new system is multi-tenant, so
migration is inherently per-company, never a single big-bang run).

## Quick start

```bash
cd migration-toolkit
npm install
cp .env.example .env   # not included yet — see "Environment" below
npm run migrate-company -- \
  --source-sheet-id <google-sheet-id> \
  --company-slug acme \
  --company-name "Acme LLC" \
  --owner-email owner@acme.example \
  --owner-full-name "Іван Іванов" \
  --owner-password <temporary-password> \
  --database-url postgresql://... \
  --dry-run
```

Drop `--dry-run` (and point `--database-url` at the real target, or rely on
`DATABASE_URL`) only once a dry run's reconciliation report looks healthy
and a human has reviewed it — a real run is a deliberate, single-operator
action, never something this CLI schedules or automates (Phase 4 design
doc §3: "No automatic/scheduled migrations").

## Architecture — why it's shaped this way

- **`sheet-schemas.ts`** — the real, exact tab names and column headers for
  all 26 migratable Google Sheets, sourced by reading `Setup.gs`/`Code.gs`
  directly (not guessed, not derived from the condensed Phase 1 doc summary
  — grepped every `logHistory_`/`requireRole_`/header-array call site across
  every `.gs` file where precision mattered). `TelegramUsers` is
  deliberately excluded (Phase 0 deferral, confirmed still out of scope by
  Phase 3 §5's own sheet-coverage table).
- **`extract.ts`** — read-only against the source spreadsheet (Google
  Sheets API via `googleapis`), builds a `name -> columnIndex` map from each
  sheet's ACTUAL row 1 rather than trusting positional order (a live sheet
  that's been through several schema versions can have columns physically
  reordered by `ensureColumnsExist_`, which only ever appends). Writes one
  timestamped JSON snapshot per sheet to disk (`snapshot-io.ts`) — the
  design doc's "immutable 'what we actually read' record," so a transform
  bug can be fixed and re-run against the same extracted data without
  re-hitting a spreadsheet that may have kept changing.
- **`transform/`** — the bulk of the real logic, entirely pure and
  in-memory (never touches Postgres, never imports `@prisma/client`,
  consistent with the design doc's own "transform never touches Postgres"
  framing). Every non-trivial piece (JSON-blob parsing, unit resolution,
  BOM CHECK-constraint validation, the default-warehouse-remainder
  computation, History row classification, stock-movement `qtyAfter`
  reconstruction) is a separately unit-tested pure function — see `*.test.ts`
  next to each module. `transform/index.ts` wires all 9 dependency-ordered
  steps together into one `TransformedCompanyGraph`.
- **`load.ts`** — writes the graph to Postgres inside a SINGLE transaction
  per company (all-or-nothing: a failure anywhere rolls back everything),
  with `SET LOCAL app.current_company_id` issued manually to activate RLS
  (mirrors `backend/src/prisma/prisma.service.ts`'s
  `runInTenantTransaction` exactly, cited in `load.ts`'s own header comment
  — not imported directly, to keep this CLI genuinely standalone rather
  than pulling in NestJS DI internals for a one-shot script). Upserts by
  `(companyId, legacyId)` wherever that unique constraint exists (the 13
  models Phase 4 §6 added it to); falls back to other natural keys
  (`email` for User, `(assemblyId, versionNumber)` for AssemblyVersion,
  `(companyId, productId, warehouseId)` for WarehouseStock) or a documented
  "skip if the company already has any rows" posture for the handful of
  entities with no natural idempotency key at all (`ProductionStage`,
  `QcChecklistItem`, `StockMovement`, `AuditEvent` — none of these carry a
  `legacyId` field in the schema).
- **`verify.ts`** — the reconciliation report (row counts, the
  total-qty-vs-warehouse-stock sum check, referential-completeness warning
  summaries, and a live spot-check sample of migrated Products against
  their source rows), written to `LegacyMigrationRun.reconciliationReport`
  after every run.
- **`cli.ts`** — `migrate-company`, wiring all 4 stages together with a
  `--dry-run` flag that REQUIRES an explicit `--database-url` (never falls
  back to a possibly-production `DATABASE_URL` env var when dry-running).

## Real, disclosed judgment calls made while building this

These are places where the Phase 4 design doc left a genuine gap or was
silent, and a concrete decision had to be made. Each is called out in the
relevant source file's comments too — summarized here for one-stop review:

1. **Legacy Users have no email column at all** (`Users` sheet headers:
   `ID, Login, PasswordHash, Role, FullName, Active, CreatedAt`) but
   `User.email` is required and globally unique. Every migrated user gets a
   synthesized placeholder (`login@<company-slug>.legacy.local`) — real
   users should update their email after first login.
2. **Legacy roles don't map 1:1 to the new RBAC.** The legacy system has
   exactly 3 hardcoded roles (`admin`/`storekeeper`/`viewer`, confirmed from
   `permissions.catalogue.ts`'s own header comment — not guessed), while the
   new system seeds 5 (`Admin`/`Storekeeper`/`Production`/`Sales`/`Viewer`).
   Migrated users map to their same-named role; nobody is auto-assigned
   `Production`/`Sales` — an admin can re-assign roles post-cutover via the
   real Users/Roles UI (Task 77).
3. **`ProductionStage`/`QcChecklistItem` are migrated from their real
   per-company sheets, not the "seed default list."** The Phase 4 design
   doc's step 2 mentions seeding a default stage/checklist list, but the
   REAL Phase 5 implementation (`CompanyService.createCompany`'s own header
   comment) deliberately does NOT seed these for a normal signup — "the
   legacy system has no fixed default list for either." A migration has
   real legacy rows to carry forward instead, which is strictly more
   faithful; this toolkit does that, diverging from a literal reading of
   the design doc on purpose.
4. **`StockHistory`'s two JSON-blob-adjacent gaps**: `StageHistoryJson`'s
   `user` field is a login string, not a legacy row id, and this schema has
   no reliable way to resolve a bare login back to a specific migrated
   `User` without a name/login cross-reference — stage-event authorship
   falls back to the migration operator's own account, with the real
   `stageIndex`/timestamp preserved exactly. `StockMovement.qtyAfter` (a
   REQUIRED column) is never present in the source data at all — the old
   `History` sheet only ever stored a per-event delta. Reconstructed
   correctly via `transform/stock-movement-balance.ts`: walk each product's
   movements BACKWARD from the known-correct final `Products.Qty`,
   subtracting each delta — exact, as long as `Products.Qty` really does
   equal the sum of every migrated movement for that product (if some
   historical change was genuinely never logged, per Phase 1 §10's
   documented technical debt, that product's OLDER reconstructed values
   would be off by a constant amount, even though the newest one is always
   exactly right by construction).
5. **BOM CHECK-constraint violations are EXCLUDED, not passed through to
   load.** A single inconsistent `componentType`/`productId`/`subAssemblyId`
   row would fail the ENTIRE company's single-transaction load via the
   decision-2 raw-SQL CHECK constraint — the design doc says transform
   should "validate this itself first," but doesn't fully specify
   exclude-vs-abort. This toolkit excludes the bad row (with a loud
   warning) rather than let one bad BOM line sink an entire company's
   migration.
6. **Every other unresolved cross-reference (unit, supplier, article,
   employee, warehouse, consumed serial, etc.) is flagged and excluded/
   nulled, never silently dropped or fatal.** Consistent with the "flag the
   rest" pattern the design doc explicitly uses for supplier/product
   matching, extended uniformly to every other resolution this toolkit does.

## What has and hasn't been exercised for real

**Never run against a real Google Sheet or a real Postgres in this
sandbox** — same standing network-boundary as every other
external-API-touching piece of this whole project (Prisma's
`binaries.prisma.sh`, a live Postgres, a live Gemini key, live Stripe).
Two closely related but distinct gaps:

- `extract.ts`/`load.ts`/`verify.ts`/`cli.ts` import real
  `googleapis`/`@prisma/client` APIs and are structurally correct against
  those libraries' real contracts and this repo's real
  `prisma/schema.prisma` (every field name in `load.ts` was cross-checked
  against the schema by hand, not assumed), but `prisma generate` cannot
  run here (`403` on `binaries.prisma.sh`, confirmed by trying again for
  this task specifically, including the `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`
  workaround) — so `tsc` type-checks these files against an UN-generated,
  permissive `@prisma/client` stub, not the real schema-specific types. It
  compiled clean, but that is a weaker signal than the pure `transform/*.ts`
  modules' verification (which import nothing from `@prisma/client` at all,
  specifically so `tsc` COULD fully verify them here).
- `transform/*.ts` (every file except `index.ts`, which is the orchestrator
  wiring them together) has real unit test coverage — **11 suites, 90
  tests, all passing**, `tsc --noEmit` clean — because every non-trivial
  piece of transform logic is a pure function with no I/O dependency.

**Before a real company's cutover**, an operator must: run a real
`--dry-run` against a disposable Postgres with a real generated
`@prisma/client` and read the full reconciliation report, not just this
toolkit's own test suite — the test suite proves the pure logic is
internally consistent, not that it produces a correct migration against a
real customer's real spreadsheet quirks.

## Verification performed

Clean scratch `npm install` (343 packages), `tsc --noEmit` clean across the
whole package, `jest --ci` **90/90 tests passing across 11 suites**:
`sheet-schemas.test.ts` (schema-config sanity), `transform/id-map.test.ts`,
`units.test.ts`, `products.test.ts`, `bom.test.ts`, `production-json.test.ts`,
`qc-json.test.ts`, `warehouse-remainder.test.ts`, `history-classify.test.ts`,
`parsing.test.ts`, `stock-movement-balance.test.ts`. One environment-only
hiccup during this pass, not a code issue: a jest worker was `SIGKILL`ed
under sandbox resource pressure on one parallel run — `--runInBand` (serial
execution) resolved it immediately, consistent with similar transient
resource flakiness seen elsewhere in this project's verification history
(the frontend's `Bus error` from a truncated SWC binary, for instance).
