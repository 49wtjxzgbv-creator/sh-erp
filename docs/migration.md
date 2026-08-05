# SH ERP v2 — Legacy Data Migration

How to move one customer's data from their existing Google Apps Script deployment (Sheets + Drive) into SH ERP v2. This document is the operator-facing runbook; `migration-toolkit/README.md` is the engineering reference (architecture, every disclosed judgment call, exact verification results) — read both before a real cutover, this file doesn't repeat everything there.

Migration is **per company**, always. The legacy system is one Apps Script deployment per customer; SH ERP v2 is multi-tenant. There is no single "big-bang" migration — each customer is migrated independently, on their own schedule, via the same `migrate-company` command every time (first real cutover and every later customer's onboarding use the identical code path).

## Prerequisites

1. **The target database must already have all three migrations applied** (`prisma/migrations/20260803000000_init`, `20260804000000_create_auth_service_role`, `20260805000000_enable_rls_and_check_constraints`, in that order) — see `docs/deployment.md`. Migrating data into a database missing the baseline schema will fail immediately and loudly, not silently.
2. **A Google service-account key with read access to the customer's spreadsheet.** Share the legacy Sheet with the service account's email (Viewer is sufficient — extraction is read-only, confirmed by reading `extract.ts`, which only calls `spreadsheets.values.get`, never a write method).
3. **A disposable/scratch Postgres instance for the dry run** — not a shared staging database another migration or manual testing might be using concurrently, since `--dry-run` still does a real write, just against a database you can safely throw away.
4. **A decision on the owner account**: email, full name, and a temporary password for the migrated company's first Admin user (the legacy system's `Users` sheet has no email column at all — see judgment call #1 below).

## Running a migration

```bash
cd migration-toolkit
npm install
npm run prisma:generate   # generates the Prisma client this toolkit needs — see the standing sandbox-limitation note in migration-toolkit/README.md if this fails with a 403 on binaries.prisma.sh
cp .env.example .env      # optional — every value below can also be passed as a CLI flag
```

### Step 1 — dry run

```bash
npm run migrate-company -- \
  --source-sheet-id <google-sheet-id> \
  --company-slug acme \
  --company-name "Acme LLC" \
  --owner-email owner@acme.example \
  --owner-full-name "Іван Іванов" \
  --owner-password <temporary-password> \
  --database-url postgresql://scratch-user:...@scratch-host:5432/scratch_db \
  --dry-run
```

`--dry-run` **requires** an explicit `--database-url` — the CLI refuses to fall back to a `DATABASE_URL` environment variable when dry-running, specifically so an operator can never accidentally dry-run against whatever database happens to be configured in their shell. This is a real write against a real (disposable) database, exercising the actual RLS policies, CHECK constraints, and immutability grants — not a rolled-back transaction against production, and not a simulation.

Extraction saves a timestamped JSON snapshot to `./snapshots/` (or `--snapshot-dir`) before anything is transformed or loaded — an immutable "what we actually read" record. If a transform bug is found and fixed, re-run against the same snapshot instead of re-hitting the spreadsheet (which may keep changing) via `--from-snapshot latest` (or an explicit snapshot directory).

### Step 2 — read the reconciliation report

The CLI prints a summary at the end of every run:

- **Row counts** per sheet, flagged `OK`/`MISMATCH`.
- **Sum check**: does `Product.qty` (the running total) equal the sum of every migrated `StockMovement` for that product? A mismatch here is the strongest signal something is wrong, since it means the reconstructed movement history (see judgment call #4) doesn't actually add up to the known-correct final quantity.
- **Spot checks**: a live sample of migrated Products re-fetched from the target database and compared field-by-field against the source.
- An overall `LOOKS HEALTHY` / `NEEDS REVIEW` verdict (`report.looksHealthy`) — `NEEDS REVIEW` sets a non-zero exit code, so this is scriptable, but **a human must actually read the full report before treating any migration as trustworthy**, not just check the exit code. The full report is also written to `LegacyMigrationRun.reconciliationReport` in the database itself for later reference.

**Do not proceed to a real cutover on a report you haven't read.** The test suite (90/90 passing, see `migration-toolkit/README.md`) proves the transform logic is internally consistent — it does not prove a specific customer's real spreadsheet, with whatever real-world quirks it's accumulated over years of use, migrates correctly. The dry run's reconciliation report is what actually proves that, for that customer, this run.

### Step 3 — real cutover

Per the original Phase 4 design ("a manual, single-operator action"), a real migration is never scheduled or automated by this toolkit. Once a dry run's report looks healthy and has been reviewed:

1. Freeze the legacy deployment (Phase 0's agreed strategy: freeze-and-switch, single day, no parallel-run).
2. Re-run the exact same command, dropping `--dry-run` and pointing `--database-url` at the real target (or setting `DATABASE_URL`).
3. Read the reconciliation report again — the real run's report, not the dry run's. Data can change between a dry run and the real cutover if there was any gap in time.
4. Only once that report looks healthy, switch the customer's DNS/access over to the new system and lift the freeze.

## Judgment calls to know about before reading any reconciliation report

Full detail and source citations are in `migration-toolkit/README.md`'s "Real, disclosed judgment calls" section — summarized here because they directly affect how to interpret what you'll see in a report:

1. **No email column exists in the legacy system.** Every migrated user gets a placeholder (`login@<company-slug>.legacy.local`). This is expected, not a bug — plan to have the customer update real emails post-cutover, particularly before enabling any email-dependent feature (the low-stock digest, password reset).
2. **3 legacy roles → 5 new roles, same-name mapping only.** Nobody is auto-assigned the new `Production`/`Sales` roles. Plan an admin pass after cutover to re-assign roles via the Users/Roles UI if the customer wants to use the new, more granular roles.
3. **`ProductionStage`/`QcChecklistItem` come from the customer's real sheets**, not a generic default list — if their legacy system never used those sheets, expect an empty list post-migration (configure via the admin UI, not a migration re-run).
4. **`StockMovement.qtyAfter` is mathematically reconstructed**, walking backward from the known-correct final `Products.Qty`. Exact by construction for the newest movements; if the legacy system ever had an unlogged manual quantity edit (a documented pre-existing risk, Phase 1 §10), older reconstructed values for that product could be off by a constant amount even though the current quantity is always right. The sum check in the reconciliation report is exactly what catches whether this assumption held for a given company.
5. **Inconsistent BOM rows are excluded from load, with a warning**, rather than failing the entire company's migration over one bad line. Check the warnings list for any `BOM` step entries after every run — an excluded BOM line means that assembly's component list is incomplete until someone fixes it manually post-cutover.
6. **Every other unresolved reference (unit, supplier, article, employee, warehouse, consumed serial) is flagged and excluded/nulled, never silently dropped.** Read the warnings list, not just the pass/fail summary — a healthy-looking report can still carry warnings worth following up on.

## What this toolkit has not been proven to do

Stated plainly, not glossed over: neither this toolkit nor this document has been exercised against a real Google Sheet or a real Postgres instance — the sandbox this project was built in has never had network access to run `prisma generate` (403 on `binaries.prisma.sh`) or reach the Google Sheets API. Every transform function has real, passing unit-test coverage (90/90 tests) because that logic is pure and testable without either external dependency, but the extract/load/verify/CLI layer is only verified by careful cross-referencing against the real `prisma/schema.prisma` and the `googleapis`/`@prisma/client` library contracts — not by an actual run. **The first dry run against a real customer's real spreadsheet and a real disposable Postgres instance is the first time this toolkit will have actually executed end-to-end.** Budget time for that dry run to surface something this document didn't anticipate, and don't treat a clean `npm test` as equivalent to a clean dry run.
