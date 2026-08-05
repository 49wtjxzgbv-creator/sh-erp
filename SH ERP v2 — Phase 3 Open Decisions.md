# SH ERP v2 — Phase 3: Open Architecture Decisions

Detailed expansion of the 5 open items from "SH ERP v2 — Phase 3 Architecture Review.md". Phase 4 does not start until all 5 are finalized.

---

## Decision 1: `Product.unit` — foreign key to `CompanyUnit`, or keep as free text?

**Problem.** `Product.unit` is a free-text `String` (`@default("шт")`), even though a `CompanyUnit` lookup table already exists in the schema for exactly this purpose. Nothing ties the two together. Two products meant to use the same unit can silently diverge ("шт" vs "шт." vs "ШТ"), there's no way to rename a unit globally, and no way to restrict which units a company's products may use.

**Option A — Add the FK.** Change `Product.unit` to `unitId String @db.Uuid` referencing `CompanyUnit(id)`.

**Option B — Leave as free text.** Keep the status quo.

**Pros of A:** real referential integrity; renaming a unit is one `UPDATE` instead of a data-cleanup project; enables clean unit-based filtering/reporting; consistent with how every other lookup in the schema is modeled (`Supplier`, `Warehouse`, etc.); matches the "do not migrate technical debt" requirement — this is precisely the kind of free-text-standing-in-for-a-relation pattern the whole Phase 3 JSON-blob-expansion effort was built to eliminate.

**Cons of A:** requires a migration step mapping every legacy unit string onto a `CompanyUnit` row (needs to happen during Phase 4 anyway, so marginal cost is low); makes `unit` a required FK, so `CompanyUnit` seeding must happen before any `Product` rows load for a company (an ordering constraint Phase 5's onboarding flow needs to respect).

**Pros of B:** zero migration risk; matches the legacy `Products` sheet exactly; no seed-ordering dependency.

**Cons of B:** leaves `CompanyUnit` as a table that exists but isn't actually used where it matters most; retrofitting the FK after go-live means migrating real production `Product` rows across every live tenant under RLS — a much harder migration than doing it now against zero data.

**Recommendation: Option A.** Cheap now, expensive later — there's no live data yet, so this is the correct time to pay this cost.

**Long-term impact.**
- *Scalability:* negligible either way at current row counts; A keeps unit-based indexes/reports meaningful at any scale.
- *Maintenance:* A meaningfully lowers cost — a future unit rename becomes a single update, not a per-tenant data-cleanup exercise.
- *Commercial SaaS:* directly relevant to the planned i18n rollout (English/Polish/German later) — per-locale unit display names are only tractable if units are a real entity with an id to attach translations to, not text duplicated across every product row.

---

## Decision 2: `CHECK` constraints via hand-edited raw-SQL migration

**Problem.** No DB-level enforcement exists for basic invariants: no non-negative quantity guarantee, and `AssemblyComponent`/`AssemblyVersionComponent`'s `componentType`-vs-nullable-FK consistency (`productId` set XOR `subAssemblyId` set, matching `componentType`) is app-layer-only. A validation bug could write inconsistent BOM data or negative stock straight into production.

**Option A — Add `CHECK` constraints** via the same hand-edited raw-SQL migration mechanism already used for RLS policies and the immutability `REVOKE` grants: e.g. `CHECK (assembly_id <> sub_assembly_id)`, a componentType-consistency check, selectively-applied non-negative checks.

**Option B — App-layer only.** Rely entirely on NestJS DTO validation and service-layer checks; no DB constraints.

**Pros of A:** defense in depth — invalid data becomes impossible to write through *any* path (API, a future admin tool, a raw `$queryRaw` call, a data-fix script), not just the one path a developer happened to validate; catches bugs at write time instead of silently corrupting cost/inventory data that's only noticed in a report months later (this is exactly the shape of Phase 1's documented real production incident).

**Cons of A:** every `CHECK` constraint must be manually re-added after each `prisma migrate dev --create-only` regenerates the migration file — extra operational overhead, already accepted for RLS but now applied more broadly, and easy to forget without a runbook; risk of an overly strict constraint blocking a legitimate future feature (e.g. a negative-quantity `CHECK` could conflict with a future backorder/negative-stock mode) if applied too broadly.

**Pros of B:** simpler migration process, no manual SQL-editing step, no risk of a too-strict constraint blocking a future feature.

**Cons of B:** zero DB protection against bad writes; given the explicit "maintainable for years" requirement, an app-only guarantee erodes as more code paths (new modules, batch jobs, admin tooling) are added that may not all go through the same validation layer.

**Recommendation: Option A, scoped narrowly.** Apply `CHECK` constraints to invariants that are permanent business rules regardless of future features (componentType consistency, self-reference prevention). Leave broad non-negative-quantity constraints as a per-table Phase 5 product decision rather than blanket-applying them now, so a legitimate future negative-stock feature isn't preemptively blocked.

**Long-term impact.**
- *Scalability:* no impact — `CHECK` constraints are cheap per-row on write at any realistic scale.
- *Maintenance:* reduces long-tail risk in a multi-year, multi-contributor codebase — a future contributor (human or otherwise) can't silently corrupt BOM data even if their code skips business-logic review.
- *Commercial SaaS:* "our inventory numbers are provably consistent" is a real reliability signal for a paid product, and a direct improvement over the old system's silent-corruption failure mode.

---

## Decision 3: `citext` for case-insensitive `article`/`email`

**Problem.** `Product.article` is documented as "unique business key, case-insensitive within a company," and `User.email` is conventionally expected to be case-insensitive too — but the actual `@@unique` constraints are ordinary case-sensitive Postgres text comparisons. `"ABC-100"` and `"abc-100"` currently pass as distinct, non-colliding values.

**Option A — Enable `citext`.** Turn on Prisma's `postgresqlExtensions` preview feature, declare `extensions = [citext]` in the `datasource` block, change `article`/`email`/`login` to `@db.Citext`.

**Option B — App-layer normalization.** Keep plain `String`/`text`; lowercase-normalize on every write and every lookup in application code.

**Pros of A:** guaranteed at the DB layer regardless of which code path performs the write — same defense-in-depth logic as Decision 2; `citext` is a mature, stable, widely-used Postgres extension, low operational risk in practice despite Prisma badging the integration as "preview."

**Cons of A:** requires enabling a Prisma *preview* feature, which needs re-verification on every Prisma version upgrade; requires the `citext` extension to be installed on the production Postgres instance (trivial on Supabase/most managed Postgres, but a real provisioning checklist item); a non-default column type that anyone writing raw SQL against the DB needs to know about.

**Pros of B:** no preview feature, no extension dependency, fully standard Postgres types.

**Cons of B:** purely convention-based — any code path that forgets to normalize case (a bulk importer, a future mobile client, a one-off admin script) reintroduces the exact bug. This review already found one instance of a "convention, not enforced" gap silently breaking (6 tables that quietly dropped the `companyId` convention) — the pattern repeats easily.

**Recommendation: Option A.** Given the stated multi-year maintainability requirement and the demonstrated tendency of convention-only rules to erode, the DB-enforced guarantee is worth the modest preview-feature overhead.

**Long-term impact.**
- *Scalability:* no measurable impact — `citext` indexes perform comparably to regular btree text indexes.
- *Maintenance:* removes an entire category of "two accounts differ only by email case" support/debugging tickets — expensive to diagnose in a multi-tenant system (is it a data bug, an app bug, or tenant data entry?).
- *Commercial SaaS:* email case-sensitivity login failures are a classic early-SaaS churn driver — cheaper to close this before real customers exist than after the first support ticket.

---

## Decision 4: Composite foreign keys for cross-tenant referential integrity

**Problem.** Standard single-column FKs (e.g. `WarehouseStock.productId → Product.id`) only validate that the referenced row exists — not that it belongs to the same company as the referencing row. Postgres RLS protects which *rows* a request can see or touch, but does nothing to stop a same-tenant write from linking to a *different* tenant's entity (e.g. a bug that writes a `WarehouseStock` row for Company A's warehouse pointing at Company B's product). This is the largest, most consequential open decision of the five.

**Option A — Composite foreign keys.** Every relation between two tenant-scoped tables adds `companyId` to the FK, referencing a composite unique index `(companyId, id)` on the target instead of just `id` — e.g. `WarehouseStock`'s FK becomes `(companyId, productId) → Product(companyId, id)`.

**Option B — App-layer enforcement + reconciliation job.** Keep single-column FKs as they are today; rely on the Prisma Client Extension (already planned, Phase 2 §11.4) to validate `companyId` consistency on every write linking two entities, backed by a scheduled job that periodically scans for any FK pair with a `companyId` mismatch and alerts on it.

**Pros of A:** the strongest possible guarantee — cross-tenant linkage becomes structurally impossible, not just checked for. For a product that will eventually hold thousands of companies' inventory and financial data, this is the single highest-value integrity property available: a leak or corruption incident here is both a customer-trust catastrophe and, depending on contract terms, a real legal/compliance exposure.

**Cons of A:** the most invasive change of the five — touches all ~70+ tenant-scoped relations, widens every affected index by one UUID column (minor real cost, mostly a schema-complexity cost), and Prisma's composite-FK syntax is more verbose to write and read. This is realistically the largest single edit made to the schema so far, and needs the same fresh structural re-verification this review just did. It's also the item most likely to delay Phase 4 if done exhaustively.

**Pros of B:** a much smaller change (effectively today's status quo, plus building the reconciliation job); centralizes enforcement in one place (the Prisma Client Extension) rather than spreading composite keys across the whole schema; the reconciliation job adds ongoing *visibility* (an alert/dashboard) that a silent DB constraint wouldn't give — you'd actually see how often this class of bug would have occurred.

**Cons of B:** depends on every write path going through the extension correctly, forever — including future code the extension wasn't written with in mind (raw SQL data-fix scripts, admin tooling, a future mobile/API integration surface per the mobile-readiness requirement). A single missed path reintroduces exactly the risk Option A removes structurally. The reconciliation job is a detect-after-the-fact control, not a prevent-before-the-fact one — by the time it fires, a leak may already have been visible to a customer.

**Recommendation: Option A, done now, before Phase 5 and before any customer data exists.** This mirrors Decision 1's cost asymmetry (cheap on an empty schema, very expensive to retrofit against live cross-tenant data later) combined with a much higher severity ceiling than Decision 1 — a cross-tenant leak is close to worst-case for a commercial multi-tenant product. If the owner prefers to move faster and defer, Option B is only defensible if the reconciliation job is actually built and running before any paying customer's data goes live, not left as a "someday" item.

**Long-term impact.**
- *Scalability:* composite indexes are marginally larger than single-column ones but not a real scalability concern at "millions of records, thousands of companies" — Postgres handles composite B-tree indexes at that scale without difficulty. Option B's reconciliation job, by contrast, needs its own scaling strategy (a periodic full scan across every tenant-scoped table) that grows as a real background-job cost over time — ironically introducing a scalability problem Option A doesn't have.
- *Maintenance:* Option A is a one-time cost, invisible forever after. Option B is a standing cost — the reconciliation job needs ongoing monitoring and alert triage, and every module added from Phase 5 onward needs a developer to remember to route relevant writes through the extension correctly.
- *Commercial SaaS:* this decision determines what can honestly be told to an enterprise prospect's security/procurement reviewer — "cross-tenant isolation is enforced at the database layer" (Option A) is a materially stronger claim than "enforced by application code, monitored by a reconciliation job" (Option B), and a multi-tenant product aiming to eventually compete for Odoo/NetSuite-class buyers will face exactly this question in a security review.

---

## Decision 5: Explicit `onDelete`/`onUpdate` policy per relation

**Problem.** None of the 70+ relations in the schema specify a delete/update policy — Prisma and Postgres fall back to implicit defaults per relation, meaning current delete behavior across the schema is whatever those defaults happen to resolve to, not a deliberate, reviewed choice. This is also inconsistent with the schema's own soft-delete convention (`deletedAt`), which implies hard deletes should be rare by design, not governed by whatever a relation's default happens to be.

**Option A — Decide it all now.** A dedicated pass across the current 48-model schema, assigning `onDelete` per relation (e.g. `Restrict` from `Company` downward, since company removal is soft-delete-only; `Cascade` from `ProductionOrder` to its child expansion tables, since they only exist in the order's context; `SetNull` where a reference is genuinely optional and should outlive its target, e.g. `Product.defaultSupplierId`).

**Option B — Defer to Phase 5.** Decide cascade behavior module-by-module as each module's real deletion workflow is actually designed and built, rather than speculating about all of them up front.

**Pros of A:** one consistent, reviewed decision instead of scattered ad hoc choices made under Phase 5 delivery pressure by whichever developer touches that module first; avoids a real bug class where a delete either fails unexpectedly (a default `Restrict` blocking a delete that should have cascaded) or succeeds too destructively (a default that cascades further than intended); matches the project's own established discipline of documenting decisions once (ADRs) rather than rediscovering them per module.

**Cons of A:** deciding cascade behavior for 70+ relations in the abstract, without the real service-layer deletion logic in front of you, risks getting some wrong — "should deleting a `Warehouse` cascade to its `WarehouseStock` rows, or should the delete be blocked while stock exists?" is really a UX/business-rule decision, not a pure schema one, and guessing now risks a wrong default that Phase 5 has to revisit anyway.

**Pros of B:** each decision gets made with full context — the actual NestJS service method and the actual UX flow ("can a warehouse with stock be deleted? what does the confirmation say?") — lowering the risk of an abstractly-reasonable-but-practically-wrong choice.

**Cons of B:** ships into Phase 5 with Prisma's implicit defaults live in the interim (true today regardless, so this is really "the status quo risk continues a bit longer"); defers a decision that's cheap to make as a lightweight default now and risks never getting systematic attention if left to be implicitly decided module-by-module under delivery pressure.

**Recommendation: hybrid, tilted toward B.** Set a lightweight schema-wide default posture now — "Restrict by default from tenant-root-level entities; child/expansion tables that only exist in their parent's context get Cascade; everything else stays Restrict unless a module's design says otherwise" — a 30-minute decision, clearly smaller in scope than Decision 4. Let each module's Phase 5 implementation confirm or override that default against its real deletion UX, documented per module as it's built, rather than either guessing all 70+ relations blind now or shipping with no policy at all.

**Long-term impact.**
- *Scalability:* no impact — `onDelete` policy affects write-time cascade behavior only, not query performance.
- *Maintenance:* a documented default posture, even a lightweight one, prevents an inconsistent, module-by-module-invented set of delete behaviors that later confuses a new contributor ("why does deleting a `Supplier` cascade but deleting a `Warehouse` doesn't?").
- *Commercial SaaS:* delete behavior is directly customer-visible — "I tried to delete a product and got a confusing error" vs. "I deleted a product and all its order history silently vanished" are both bad outcomes in opposite directions. Worth a stated policy, even minimal, before real customer data exists.

---

## Summary table

| # | Decision | Recommendation | Do now / defer |
|---|---|---|---|
| 1 | `Product.unit` → FK to `CompanyUnit` | Option A (add FK) | Now — cheap, no live data yet |
| 2 | `CHECK` constraints via raw SQL | Option A, scoped narrowly | Now, before Phase 5 |
| 3 | `citext` for `article`/`email` | Option A (enable) | Now, before Phase 5 |
| 4 | Composite FKs for cross-tenant integrity | Option A (composite FKs) | Now — cheapest before customer data exists |
| 5 | Explicit `onDelete`/`onUpdate` policy | Hybrid: lightweight default now, per-module confirmation in Phase 5 | Partial now, rest deferred |

Waiting on your decisions before Phase 4 starts.
