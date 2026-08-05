# SH ERP v2 — Phase 2: Complete Architecture (revised)

Grounded in "SH ERP v1 — System Documentation.md" (Phase 1) and the Phase 0 decisions (multi-tenant day one, freeze-and-switch cutover, transparent password re-hash, Telegram deprioritized, billing-ready, i18n-ready, flexible RBAC, scale for millions of records / thousands of companies). No production code is written in this phase — this is the design that Phase 3 (schema) and Phase 5+ (implementation) will be built against and checked against.

**Revision note**: sections 17–25 were added after the owner's first review, before Phase 2 approval — one-click deployment/CI-CD, plugin-oriented modules, feature flags, API deprecation policy, a numeric backup/DR plan (RTO/RPO), coding standards & PR process, mobile-readiness, horizontal-scaling guarantees, and Architecture Decision Records. Sections 1–16 are unchanged from the first draft.

A few places below are genuine judgment calls (monolith-vs-microservices, subdomain routing, storage provider, log aggregator). Each is flagged explicitly as a **recommendation** with its reasoning, not a silent decision — push back on any of them and it changes downstream phases, not just this document.

---

## 1. System shape: modular monolith, not microservices

**Recommendation.** A single NestJS application, internally organized into strictly-bounded modules, deployed as horizontally-scaled stateless pods, with background work split into separate worker processes from day one.

Why not microservices, given requirement #5 ("every module must be independent and scalable"): microservices buy independent *deployability*, but the tax is paid immediately — distributed transactions, service-to-service auth, network latency between what used to be a function call, and an ops burden that assumes a platform team. A two-person-scale team building an Odoo/Katana-class competitor gets more real velocity from a modular monolith with disciplined internal boundaries, and "independent and scalable" is achieved differently: every NestJS module talks to every other module only through its exported service interface (never reaches into another module's Prisma models directly), which means any module that later needs to scale independently (AI, reporting, background workers) can be extracted into its own deployable with a mechanical refactor, not a rewrite. Background job workers already run as a separate process/deployment from the API (§9), which is the load pattern most likely to need independent scaling first (bulk imports, AI invoice OCR, report generation) — that's built in from day one, not deferred.

If and when a specific module's load genuinely outgrows the monolith (e.g. AI usage across thousands of companies), it gets extracted then, informed by real metrics, not speculatively now.

---

## 2. Backend architecture (NestJS)

### 2.1 Module map

Each Phase-1-documented Apps Script file domain becomes one NestJS module. This mapping is deliberate — it keeps the audit trail from old system → new system traceable, per the "preserve all business logic" requirement.

| NestJS module | Replaces (Phase 1 `.gs` files) | Core responsibility |
|---|---|---|
| `IdentityModule` | Auth.gs, Users.gs | Login, JWT issuance/refresh, password hashing incl. legacy re-hash path, user CRUD |
| `TenancyModule` | (new) | Company (tenant) CRUD, membership, subdomain resolution, plan/billing stub |
| `AuthorizationModule` | (new, replaces hardcoded role checks) | Roles, permissions, policy evaluation, field-level sensitivity rules |
| `CatalogModule` | Products.gs, ImportExport.gs, Labels.gs | Product CRUD, search/filter, Excel import/export, label data |
| `InventoryModule` | Warehouse.gs, Warehouses.gs, InventorySessions.gs | Stock movements, virtual warehouses, inventory counts |
| `BomModule` | Assemblies.gs | BOM CRUD, versioning, recursive cost calculation |
| `ProductionModule` | ProductionOrders.gs, ProductionStages.gs, FinishedGoods.gs | Reserve→start lifecycle, stage tracking, serialized finished goods |
| `QualityModule` | QualityControl.gs | QC checklist config, inspection records |
| `SalesModule` | CustomerOrders.gs, Shipments.gs | Customer orders, shortage analysis, shipments |
| `ProcurementModule` | PurchaseOrders.gs, Suppliers.gs | Purchase orders, receiving, suppliers |
| `HrModule` | Employees.gs, Payroll.gs | Employees, piecework/advance/bonus/penalty payroll |
| `ReportsModule` | Reports.gs, Settings.gs (stats parts) | Dashboards, reorder suggestions, valuation, production reports |
| `SettingsModule` | Settings.gs, Branding.gs | VAT rate, units, dashboard config, branding assets, backups |
| `FilesModule` | Drive.gs | Storage abstraction (§7) used by every module that attaches files |
| `AiModule` | Gemini.gs, AI_FullAssistant.gs | Provider-abstracted AI, tool registry, confirmation flow |
| `NotificationsModule` | Automation.gs (digest email); Telegram.gs deprioritized | Email, in-app notifications; queue-backed |
| `AuditModule` | History.gs | Immutable event log, replaces free-text History rows with structured events |
| `BillingModule` | (new, stub) | Plan/subscription model, Stripe integration point (not implemented yet, per Phase 0) |

`Reports.gs`'s `getBootstrapData` pattern (bundling several reads into one call to cut round-trip cost) is preserved conceptually as a single `GET /api/v1/dashboard/bootstrap` endpoint — same motivation (fewer round trips), achieved properly this time via one well-indexed query set instead of Apps Script's cold-start tax.

### 2.2 Internal module layering

Every module follows the same internal shape:

```
modules/production/
  production.module.ts
  production.controller.ts        // HTTP layer only — no business logic
  production.service.ts           // business logic, orchestrates repositories
  production-orders.repository.ts // Prisma queries scoped to this module's models
  dto/
    create-production-order.dto.ts
    start-production-order.dto.ts
  entities/                        // response shape types (class-validator + swagger decorated)
  events/                          // domain events this module emits (e.g. ProductionOrderStarted)
  production.service.spec.ts
  production.controller.e2e-spec.ts
```

- Controllers never touch Prisma directly — always through the service.
- Services never bypass the module's own repository layer to hit another module's tables directly; cross-module needs go through the other module's exported service (injected via NestJS DI) or through a domain event (§2.4).
- All request/response shapes are DTOs, validated with `class-validator` + `class-transformer` (`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` applied globally) — this is what "strongly typed with TypeScript" (requirement #8) means end-to-end, not just `.ts` file extensions: no `any`, no untyped request bodies, Prisma's generated types flow through to DTOs via mapped types (`PartialType`, `PickType`) so the DB schema and API contract can't silently drift apart.

### 2.3 Cross-cutting concerns (global, applied once)

- **`TenantContextMiddleware`** — resolves `company_id` from the verified JWT claim (never from a URL param or header alone — see §11 on tenant-spoofing prevention) and stores it in an `AsyncLocalStorage`-backed request context (via `nestjs-cls`), available to every service and to the Prisma extension in §11 without threading it through every function signature by hand.
- **`JwtAuthGuard`** — verifies the access token; public endpoints (login, health check, public company branding lookup) are explicitly `@Public()`-decorated opt-outs, never the default.
- **`PermissionsGuard`** — reads a `@RequirePermission('products:write')` decorator on the route handler and checks it against the resolved user's effective permissions for the current company (§6).
- **`GlobalExceptionFilter`** — every thrown error, whether a Nest `HttpException`, a Prisma error, or a domain exception, is normalized into one response envelope (§13).
- **`AuditInterceptor`** — for any mutating request that completes successfully, writes a structured row to the audit log (§10.5) — this is the direct, durable replacement for `logHistory_`, but as real structured data (actor, action, entity type/id, before/after diff) instead of a free-text sentence.
- **`LoggingInterceptor`** — attaches a request ID, logs method/route/duration/status/company_id/user_id for every request (§12).

### 2.4 Domain events (in-process, for now)

Where the old system had implicit coupling (e.g. `startProductionOrder` reaching directly into `Payroll.gs`'s `createPayrollEntriesForOrder_`), the new architecture uses an in-process event emitter (`@nestjs/event-emitter`) so `ProductionModule` emits `ProductionOrderStarted` and `HrModule` listens for it to create piecework entries, rather than one module importing and calling into another's internals. This is a mechanical, in-process pattern today (no message broker needed at this scale) but the event contracts are designed so that, if a module is later extracted into its own service, the same events can be re-emitted onto a real queue (BullMQ/Redis pub-sub, already present per §9) without changing the event shape.

### 2.5 Testing (requirement #10: every feature testable)

- **Unit tests** (Jest): every service method, with Prisma mocked (`jest-mock-extended` against the Prisma client type) — fast, no DB needed, run on every commit.
- **Integration/e2e tests** (Jest + Supertest): spin up the real Nest app against a disposable Postgres (docker-compose `postgres:16` in CI, migrated fresh via `prisma migrate deploy`), hit real HTTP endpoints, assert real DB state — this is where multi-tenant isolation is proven (§11.4), not just unit-mocked.
- **Contract tests**: the OpenAPI spec generated from the running app (§4) is diffed in CI against the committed spec — an accidental breaking API change fails the build before it reaches the frontend team (or the generated frontend client, §3.3).
- Coverage gate enforced in CI (not aiming for 100%, but no module ships without meaningful service-level and at least one e2e happy-path + one authorization-denied-path test).

---

## 3. Frontend architecture (Next.js)

### 3.1 Structure (App Router)

```
apps/web/
  app/
    (public)/                 // marketing/login, no auth required
      login/
      register/
    (app)/                    // authenticated shell
      layout.tsx              // sidebar, topbar, tenant context provider
      dashboard/
      products/
      inventory/
      bom/
      production/
      sales/
      procurement/
      hr/
      reports/
      settings/
    api/                      // Next.js route handlers used ONLY for things Next must own
                               // (e.g. NextAuth callback, file-upload presign proxy) — never
                               // business logic, which always lives in the NestJS API.
  components/
    ui/                        // shadcn/ui primitives
    domain/                    // feature components, mirrors backend module names
  lib/
    api-client/                 // generated, typed client (§3.3)
    auth/
  middleware.ts                // route protection + tenant/subdomain resolution
```

### 3.2 Rendering strategy

- Server Components by default for read-heavy, mostly-static views (settings pages, report shells) — fetched server-side against the NestJS API using the user's session, reducing client JS and avoiding a loading-spinner flash.
- Client Components for anything genuinely interactive and stateful: the BOM editor, the inline-editable product spreadsheet grid (a direct, properly-virtualized replacement for `JavaScript.html`'s hand-rolled `ss*` grid functions), the AI chat widget, production-order stage advancement, print-preview modals.
- No client-side reimplementation of business math (cost calculation, shortage analysis) — exactly as in the old system's design principle (Phase 1 §4: "the client is thin, the server is authoritative"), the new frontend calls the same cost/availability endpoints the backend uses internally, via React Query, rather than duplicating formulas in TypeScript on the client.

### 3.3 Typed API client (this is the direct fix for the old `call('functionName', ...)` string-keyed pattern)

The NestJS Swagger spec (§4) is used to generate a fully-typed TypeScript client (via `orval` or `openapi-typescript-codegen`) as a build step. The frontend never hand-writes a fetch call with a string function name and untyped args the way `JavaScript.html`'s `call()` did — every endpoint call is a typed function, autocompleted, and a backend DTO change that breaks a frontend call is a **compile error**, not a runtime "Невідома функція" surprise discovered by a user.

### 3.4 State management

- **Server state** (anything that came from the API): TanStack Query — caching, background refetch, optimistic updates for fast actions (stock adjust, stage advance), and the mechanism that will back a future "live dashboard" if needed.
- **Client/UI state** (modal open/closed, current spreadsheet selection, wizard step): local component state or a small Zustand store per feature — no heavyweight global store; the old system's `STATE`/`STATE_*` global-variable pattern is replaced by scoped stores per feature area.

### 3.5 Design system

Dark theme with a purple accent, "SH ERP by Shyring" branding, Apple/Linear/Stripe-quality bar as specified in your original brief — built on Tailwind + shadcn/ui components, themeable per company (the old system's admin-uploadable logo/emblem/favicon becomes a per-company `branding` record surfaced through the same `TenancyModule`/`FilesModule`, applied via CSS variables at the tenant-shell layout level).

### 3.6 Internationalization

`next-intl`, message catalogs under `messages/{locale}.json`, Ukrainian (`uk`) as the default/complete locale at launch, `en`/`pl`/`de` scaffolded with the same key structure from day one (empty or machine-translated placeholders, filled progressively) — so adding a language later is a translation task, never a code change, per your Phase 0 requirement.

---

## 4. API structure

- REST, versioned from day one: `/api/v1/...` — the version prefix costs nothing now and avoids ever having to retrofit it under a live commercial customer base.
- Resource-oriented routes mirroring the module map, e.g. `GET /api/v1/products`, `POST /api/v1/production-orders/:id/start`, `GET /api/v1/customer-orders/:id/shortage-preview`.
- Consistent conventions: pagination (`?page=&pageSize=`, capped max page size), filtering (`?status=`, `?search=`), sorting (`?sort=field:asc`), all documented per-endpoint in Swagger, not left implicit the way the old `listX(token, filter)` positional-argument functions were.
- **Swagger/OpenAPI** (requirement #7): every controller and DTO carries `@nestjs/swagger` decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, DTO `@ApiProperty`); the spec is served at `/api/docs` in non-production and generated as a build artifact for the typed client (§3.3) and for contract testing (§2.5) in all environments.
- Idempotency: mutating endpoints that could plausibly be retried by a flaky client (e.g. `startProductionOrder`, `receiveFromPurchaseOrder`) accept an optional `Idempotency-Key` header, checked against a short-lived Redis record, so a network retry can never double-execute a stock mutation — a direct, structural fix for the concurrency gaps flagged in Phase 1 §10.2.

---

## 5. Authentication flow

1. **Login**: `POST /api/v1/auth/login` — email/login + password. Server verifies against `password_hash` (argon2id, new accounts) **or**, for a migrated account still on `legacy_sha256_hash`, verifies against the legacy hash and — on success — transparently writes a new argon2id hash and clears the legacy field (this is the Phase 0-agreed transparent re-hash path, now given a concrete mechanism).
2. On success: issue a short-lived **access token** (JWT, ~15 min, signed, contains `sub` (user id), `company_id`, `role_ids`) and a long-lived **refresh token** (opaque random value, stored hashed in DB with a device/session record, ~30 days), refresh token set as an `httpOnly`, `Secure`, `SameSite=Lax` cookie — never accessible to JS, closing the XSS-token-theft gap the old `sessionStorage`-held token had.
3. **Refresh**: `POST /api/v1/auth/refresh` reads the cookie, validates it against the stored (hashed) session record, issues a new access token and **rotates** the refresh token (old one invalidated immediately) — refresh-token reuse (a sign of theft) triggers immediate revocation of that entire session family.
4. **Logout**: revokes the specific session's refresh token server-side (the old system's `logout` only cleared a cache entry — reasonable for its scale, insufficient for a multi-device commercial product).
5. **Session TTL parity**: an equivalent 8-hour idle-timeout concept is preserved via access-token short life + refresh-token idle expiry, but sliding, not a hard cliff — this is a deliberate UX improvement over the old fixed 8h that logged users out mid-shift.
6. **Multi-company membership**: a user row is global; a separate `CompanyMembership` row (with its own role) ties them to one or more companies — logging in resolves to a company selection step only if the user belongs to more than one (most users belong to exactly one, so this is invisible for them).
7. **Extensibility hook, not built now**: TOTP-based MFA fields exist on the schema design (Phase 3) from day one so it can be turned on later without a migration — "production security best practices" (requirement #9) means designing for this even though it's not in the initial commercial launch scope.

---

## 6. Authorization (flexible RBAC)

This is genuinely new capability versus the old hardcoded 3-role system (Phase 1 §11), because your requirement is per-company customizable roles, not just porting admin/storekeeper/viewer.

- **`Permission`**: a fixed, code-defined catalogue of granular capabilities, `resource:action` shaped (e.g. `products:read`, `products:write`, `products:delete`, `pricing:view`, `payroll:manage`, `production-orders:start`, `ai:use-critical-actions`). This catalogue is the one thing that *is* fixed in code (it grows when a new feature ships), because permissions must correspond to real enforcement points in the code.
- **`Role`**: per-company (with a `is_system` flag for the 4-5 default roles every new company is seeded with — Admin, Warehouse/Storekeeper, Production, Sales, Viewer — deliberately a richer starting set than the old 3, reflecting what an Odoo/Katana-class product's buyers expect). Company admins can create custom roles and attach any subset of permissions — this satisfies "customizable roles and permissions per company" directly.
- **`RolePermission`**: join table.
- **`CompanyMembership`**: `(user_id, company_id, role_id)` — a user's effective permissions for a request are always resolved through *this specific company's* membership row, never globally.
- **Field-level sensitivity** (replacing the old scattered `stripPriceIfNeeded_`/`stripPickListPrices_` pattern): a declarative `@Sensitive('pricing:view')` decorator on DTO response fields, enforced by a single serialization interceptor — one implementation, applied everywhere, instead of the old pattern of remembering to call a strip function in every individual endpoint (which is exactly the kind of place a financial-data leak bug hides).
- **AI tool permissions**: each AI tool (§8) declares the permission it requires (e.g. `getPayrollSummary` requires `payroll:manage`), checked the same way a normal endpoint would be — the AI assistant is not a permission-bypass side door.

---

## 7. File storage architecture

- **Provider**: Cloudflare R2, recommended over S3 for zero egress fees — material at this product's shape (many companies' users routinely *viewing* photos/drawings/documents, not just writing them once). S3-compatible API means this is not a lock-in decision; an S3 adapter is a config change, not a rewrite.
- **Key layout**: `tenants/{companyId}/{domain}/{entityType}/{entityId}/{filename}` — `domain` ∈ {products, assemblies, customer-orders, purchase-invoices, employees, qc, shipments, branding}, a direct mapping of the old Drive folder taxonomy (Phase 1 §8) onto object-storage prefixes.
- **Uploads**: client requests a short-lived presigned `PUT` URL from the API (`FilesModule`), uploads directly to R2 — files never proxy through the NestJS process, which matters once thousands of companies are uploading photos/invoices concurrently.
- **Downloads**: private documents (invoices, customer documents, employee photos) served via short-TTL presigned `GET` URLs, permission-checked before issuing; branding assets (logo/favicon) served via a public CDN path since they're meant to be publicly visible on the login screen, exactly like today.
- **Virus/type scanning**: file type allowlist + size cap enforced server-side before issuing an upload URL (content-type + extension check), with a hook point for an async AV scan (e.g. via a background job, §9) before a file is marked "available" — not present in the old system at all, added because file upload is one of the more common abuse vectors in a multi-tenant SaaS.

---

## 8. AI architecture

Preserves the old system's two-tier design (Phase 1 §3.7, §10.10) deliberately — it's a good, safety-conscious pattern, not a limitation to fix:

- **`AiProviderPort`**: an interface, not a hard dependency on Gemini — `GeminiAdapter` is the first implementation, but the module doesn't assume Gemini specifically, given the documented history of Gemini model/quota instability (Phase 1 §10.12/§3.7). Model reference stays alias-based, configurable per environment, never hardcoded to a dated version string.
- **Simple assistant** (`askHelp`): instruction-only, zero live-data access — ported near-verbatim, still deliberately incapable of hallucinating real numbers.
- **Full assistant** (`askFullAssistant`): function-calling over a `AiTool` provider registry — each tool is a small NestJS provider implementing `execute(args, context)`, auto-registered into the tool list, running inside the same `TenantContext` and `PermissionsGuard` checks as a normal request (so a tool can never see or touch another company's data, and a viewer-role user's AI session can't do what a viewer-role user couldn't do through the UI).
- **Critical-action confirmation**: replaces the old in-memory/token-based `needs_confirmation` pattern with a durable `PendingAiAction` DB row (tenant-scoped, expires after N minutes) — surviving a page refresh or an API pod restart, which the old stateless-Apps-Script-friendly pattern didn't need to worry about but a horizontally-scaled multi-pod API does.
- **Cost control**: per-company rate limiting (Redis token bucket) and usage metering on AI calls — a necessary addition once this is a paid multi-tenant product, and the natural hook point for a future "AI credits" billing dimension (`BillingModule`, not built yet).
- **API key**: platform-provided by default (metered against the company's plan), with an option for a company to bring their own key (mirroring the old admin-entered key, now per-company instead of singleton) — keys encrypted at rest (KMS-backed envelope encryption, not a plaintext Script Property as before).
- **Voice mode**: the Web Speech API pattern (client-side STT/TTS) carries over unchanged conceptually — it's a browser capability, not a backend concern, and there's no reason to route audio through the server.

---

## 9. Background jobs

BullMQ backed by Redis, running as a **separate worker deployment** from the API (independently scalable, per §1):

| Old mechanism | New mechanism |
|---|---|
| `dailyLowStockDigest_` (Apps Script time trigger, 8am) | BullMQ repeatable job, same cron schedule, per company opted in |
| `pollTelegramUpdates_` (1-min trigger) | N/A — deprioritized per Phase 0; when rebuilt, becomes a real webhook endpoint, not a job |
| Synchronous Excel import inside a request | Async job: upload → job queued → progress reported to the client via polling or a WebSocket/SSE channel → the old `importProgressModal`'s progress bar becomes a real job-status stream instead of a client-side loop over chunked synchronous calls |
| AI invoice OCR (`recognizeInvoiceWithAI`), which could be slow | Async job for large/slow cases, kept synchronous for small ones — same UX contract, non-blocking under load |
| Backup creation (manual button, full spreadsheet copy) | Scheduled job, §16 |
| Report generation (Excel/PDF via Telegram bot or AI export tools) | Async job producing a file in R2 + a notification, rather than blocking a request thread for a DocumentApp conversion |

Queues are per-domain (`inventory`, `ai`, `reports`, `notifications`) so one company's slow AI job never starves another company's low-stock digest — a direct structural improvement over the old single-threaded, one-script-execution-at-a-time Apps Script model.

---

## 10. Caching, logging, error handling

### 10.1 Caching
Redis, three distinct uses kept logically separate (different key prefixes/DB indices): (a) session/refresh-token/rate-limit state, (b) BullMQ's own queue storage, (c) short-TTL (seconds-to-low-minutes) caching of genuinely expensive aggregate reads — dashboard stats, warehouse valuation — invalidated explicitly on the relevant write (e.g. any stock mutation invalidates that company's dashboard cache key), not left to a wall-clock TTL to eventually catch up, since financial figures being stale invisibly is a bad failure mode for an ERP.

### 10.2 Logging
Structured JSON logs (`nestjs-pino`), one line per event, always including `requestId`, `companyId`, `userId`, `route`, `durationMs`, `statusCode`. Shipped to a log aggregator — **recommendation: Axiom or Grafana Loki** (either is fine; the concrete choice matters far less than "structured, aggregated, and queryable," which is the actual requirement). Business-meaningful actions additionally land in the audit log (§10.5), which is a Postgres table, not a log line — queryable by the product itself (a company's own "who did what" screen), not just by engineers.

### 10.3 Error handling
Global exception filter → uniform envelope:
```json
{ "statusCode": 422, "error": "INSUFFICIENT_STOCK", "message": "Not enough stock for article ABC-123", "requestId": "..." }
```
Domain-specific exception classes (`InsufficientStockException`, `DuplicateArticleException`, `BomCycleDetectedException`, etc.) map to precise HTTP codes and stable `error` codes the frontend can branch on by string, not by parsing a human sentence — a direct fix for the old system's pattern of `fail_(e.message)` bubbling raw JS error text to the client with no machine-readable code at all.

### 10.4 Exception tracking
Sentry (or equivalent) captures unhandled exceptions with full request context (minus sensitive fields — no password hashes, no raw file contents in breadcrumbs), tenant-tagged so an error can be triaged per affected company.

### 10.5 Audit log (`AuditModule`)
A single `audit_events` table: `id, company_id, actor_user_id, action, entity_type, entity_id, before (jsonb), after (jsonb), created_at`. Append-only at the application layer (no update/delete endpoint exists for it, mirroring the old `History` sheet's guarantee — but now the guarantee can also be enforced at the DB layer with a `REVOKE UPDATE, DELETE` grant, which a spreadsheet never could).

---

## 11. Multi-tenant architecture

Given "thousands of companies," **shared schema + `company_id` + Postgres Row-Level Security** is the recommended pattern — not schema-per-tenant (migrations would need to run thousands of times, connection pooling collapses past a few hundred schemas) and not database-per-tenant (same problem, worse).

### 11.1 Two enforcement layers (defense in depth)
1. **Database (RLS)**: every tenant-scoped table has a policy `USING (company_id = current_setting('app.current_company_id')::uuid)`. The API sets this session variable at the start of every request's DB transaction, from the JWT's `company_id` claim.
2. **Application (Prisma)**: a Prisma Client Extension automatically injects `company_id` into every `where` clause and every `create`/`update` payload for tenant-scoped models, reading it from the `AsyncLocalStorage` request context (§2.3) — so a developer forgetting to filter by tenant in a service method is *still* safe; it's not relying on every engineer remembering every time.

### 11.2 Tenant resolution
The JWT's `company_id` claim is authoritative for every authenticated request — never trusted from a URL path, subdomain, or header alone, which would let a malicious client simply claim to be a different tenant. Subdomain (`{companySlug}.sh-erp.com`, **recommendation**, consistent with the Linear/Notion-style SaaS UX your competitive set uses) is used only for *pre-auth* UX — resolving which company's branding/login screen to show — and is re-validated against the authenticated user's actual membership immediately after login.

### 11.3 Data model implication
Every tenant-scoped Prisma model gets `companyId String @db.Uuid` as its first indexed column, and every composite index leads with it — since virtually every query is already scoped by tenant, this keeps those indexes useful rather than redundant.

### 11.4 Isolation testing (directly answers the Phase 0-flagged risk)
A dedicated e2e test suite ("tenant isolation suite") runs in CI against every tenant-scoped table: create two companies, create a row in company A, assert company B's authenticated context can neither read nor write it, for every entity type — this is automated and gates merges, not left to code review discipline alone.

### 11.5 Company lifecycle
`TenancyModule` owns company creation (self-serve sign-up flow, seeding default roles/warehouses/units/QC-checklist/production-stages exactly as `Setup.gs`'s `seed*IfEmpty_` functions did for a single installation — now parameterized per new company instead of per single global spreadsheet), plan assignment (stub until `BillingModule` is real), and suspension/offboarding (soft-disable, not immediate hard delete, consistent with the "preserve business logic and history" principle applied to the tenant itself).

---

## 12. Migration architecture (Google Sheets → PostgreSQL)

Concretized from the Phase 0 plan using Phase 1's exact 27-sheet inventory. This is designed now; built in Phase 4; run for real only at the agreed freeze-and-switch cutover.

1. **Extract** — Sheets API v4 `spreadsheets.values.batchGet` for all 27 tabs in one call where possible; Drive API `files.list`/`files.get` for every file under the four known folders (`SHSklad_Photos`, `SHSklad_CustomerDocs`, `SHSklad_Invoices`, plus the backup-copy files) — dumped to versioned NDJSON in a staging bucket, one extraction run per source installation (i.e., per company being onboarded from an existing Apps Script deployment).
2. **Transform** — the concrete, Phase-1-informed work list:
   - Expand all 5 JSON-blob columns (`PickListJson`, `StageHistoryJson`, `AssignedWorkersJson`, `ComponentsJson`, `ChecklistJson`) into real child-table rows.
   - Convert every float EUR amount to `Numeric(12,2)`.
   - Rebuild `WarehouseStock` by computing the old implicit "default warehouse = remainder" logic explicitly into real stored rows (so the new schema has no equivalent implicit-by-omission table).
   - Reconcile `PurchaseOrders.Supplier` (free text) against `Suppliers`, backfilling a `supplier_id` FK where a confident name match exists, flagging the rest for manual review rather than silently guessing.
   - Preserve every original ID as `legacy_id` on its corresponding new row, for support traceability (a customer referencing an old `SN-000123` serial must still resolve).
   - Assign every migrated row to its company's new UUID tenant ID.
3. **Load** — Prisma-driven, transactional per company, chunked with a resumable checkpoint (so a failure partway through a large company's data doesn't require restarting from zero); referential order respected (Products → Assemblies/BOM → everything that references them, etc.).
4. **File transfer** — every Drive file streamed to R2 under the new tenant-prefixed key layout (§7); every `*Url` column in the loaded rows rewritten to the new R2 URL as part of load, not as a separate pass (avoids a window where rows point at soon-to-be-inaccessible Drive links).
5. **Verify** — an automated reconciliation report per company: row counts per table match; `SUM(Products.Qty)` matches; `COUNT(FinishedGoods)` matches; `SUM(PayrollEntries.Amount)` matches; a sample of Drive file checksums match their R2 copies. This report is what gets reviewed before a company's freeze-and-switch cutover is declared complete — not a spot-check, a full accounting.
6. **Dry-run capability** — the entire pipeline runs safely against a scratch database first, repeatably, so it can be rehearsed and its report reviewed before the one real cutover run per company (this is what makes "freeze-and-switch" safe rather than reckless — freeze-and-switch means one *real* cutover, not zero rehearsals).

---

## 13. Deployment architecture

- **Frontend**: Vercel (per original stack) — preview deployments per PR, production on merge to `main`.
- **Backend**: Railway — API service (horizontally scaled, stateless) + a separate worker service (§9) + scheduled-job runner, all from the same monorepo build.
- **Database**: Supabase Postgres (managed, includes automated backups + PITR — §16).
- **Redis**: Railway-managed or Upstash.
- **File storage**: Cloudflare R2.
- **Environments**: local (docker-compose: Postgres + Redis, seeded via Prisma), staging (mirrors production topology, used for migration rehearsals and pre-release QA), production.
- **CI/CD** (GitHub Actions): on every PR — lint, typecheck, unit tests, e2e tests against a disposable Postgres, `prisma migrate diff` check (fails the build if the committed migration doesn't match the schema — prevents migration drift), OpenAPI contract diff (§2.5). On merge to `main` — auto-deploy to staging. Production deploy is a manual promote step, and always runs `prisma migrate deploy` before the new app version starts serving traffic (never `db push` in production — every schema change is a committed, reviewed migration file, per requirement #6).
- **Secrets**: platform environment variables (Railway/Vercel secret stores), never committed; per-environment API keys (Gemini, R2, etc.).

---

## 14. Monitoring

- **Uptime**: external pinger against `/health` (checks DB connectivity, Redis connectivity, and queue worker liveness) — alerts on downtime via email/Slack webhook.
- **APM**: Sentry performance tracing (or equivalent) — slow-endpoint detection, tenant-tagged.
- **Business metrics dashboard**: active companies, API error rate, queue depth/lag, AI usage/cost per company, production orders created per day — exported from the audit log and job metrics, not guessed at after the fact.
- **Alerting thresholds**: error-rate spike, queue backlog growth, failed migration/backup job, expiring TLS/domain — routed to the same Slack/email channel as uptime alerts, single place to look.

---

## 15. Backup strategy

Directly answers a real gap in the old system, where "backup" meant a manual, owner-triggered full spreadsheet copy sitting on the same Google Drive as the live data:

- **Database**: Supabase's automated daily backups + point-in-time recovery (continuous WAL-based), *plus* a separate scheduled `pg_dump` exported to R2 (different provider than the primary DB host, so a Supabase-side incident doesn't also take out the backup) — retained on a tiered schedule (e.g. daily×14, weekly×8, monthly×12).
- **File storage**: R2 versioning enabled on the bucket (protects against accidental overwrite/delete) plus a periodic sync job mirroring to a second bucket/provider for the same "not all eggs in one basket" reason.
- **Restore testing**: a scheduled job periodically restores the latest backup into a scratch environment and runs the same reconciliation checks used in migration verification (§12.5) — an untested backup is treated as equivalent to no backup, and this is explicit, automated policy, not an assumption.
- **Tenant-level export**: every company can self-serve export their own data (Excel, as today) at any time — both a customer-trust feature and an extra, customer-held backup layer.

---

## 16. Scalability strategy

- **API tier**: stateless pods (no in-memory session state — sessions live in Redis/Postgres), horizontally scaled behind Railway's load balancing.
- **Database connections**: PgBouncer (or Prisma Accelerate) in front of Postgres — essential once "thousands of companies" means many short-lived connections; Prisma's own connection pool alone doesn't scale to that concurrency profile.
- **Read scaling**: report/dashboard-heavy queries are candidates for a read replica once real traffic data justifies it — the schema (UUID PKs, no sequential-integer assumptions baked into business logic) doesn't preclude this later.
- **Large-table partitioning readiness**: high-growth tables (`audit_events`, `stock_movements`) are designed (Phase 3) so that partitioning by `company_id` range or by time is a schema-compatible operation later, not a blocked-by-design one — not implemented at launch, since it's premature at current scale, but not designed against either.
- **Background workers**: scale independently of the API tier (§9), so a burst of AI/report jobs from one large company never degrades API latency for everyone else.
- **CDN**: static frontend assets via Vercel's edge network; company files via R2's built-in CDN path.
- **N+1 prevention**: Prisma query discipline (explicit `select`/`include`, no implicit per-row queries in loops) enforced via code review and, where it matters most (list endpoints), integration-tested query-count assertions.

---

## 17. One-click deployment & CI/CD

Goal, stated precisely: after a one-time initial setup (accounts provisioned, secrets configured, infra created), every subsequent release is `git push` to `main` → build → migrate → deploy, with zero manual steps for a normal change.

### 17.1 Docker
- One multi-stage `Dockerfile` for the NestJS side (`apps/api` and `apps/worker` share it): `deps` stage installs and caches dependencies, `build` stage compiles TypeScript, `runtime` stage copies only `dist/` + production `node_modules` onto a slim, non-root base image. Railway runs **two services from the same image**, differing only in start command (`node dist/main.js` for the API, `node dist/worker.js` for the BullMQ worker) — one image to build and scan, not two.
- Next.js is **not** Dockerized — Vercel builds and serves it natively, which is simpler and faster than a self-managed container for that tier.
- `docker-compose.yml` for local development: Postgres 16, Redis, Mailhog (local email capture), the API, the worker — `docker compose up` is the entire local onboarding step for a new contributor.

### 17.2 GitHub Actions
- `ci.yml` (every PR): install → lint → typecheck → unit tests → ephemeral Postgres+Redis service containers → `prisma migrate deploy` against them → e2e tests → `prisma migrate diff --exit-code` (fails the build if `schema.prisma` and the committed migrations have drifted) → OpenAPI contract diff (Phase 2 §2.5/§4) → Docker image build (layer-cached).
- `deploy-staging.yml` (on push to `main`, after `ci.yml` passes): deploy the built image to the Railway staging services; Vercel deploys the frontend via its own native GitHub integration in parallel.
- `deploy-production.yml`: gated by a GitHub Environment protection rule (manual approval, or an automatic promote after a defined staging soak window) — runs `prisma migrate deploy` against production as its own job step that must succeed *before* the new API version starts receiving traffic (Railway's pre-deploy/release-phase command), then deploys.
- **Migration safety rule, stated as policy**: `prisma migrate dev` and `db push` are local/dev-only commands, never run against staging or production. `migrate deploy` is idempotent — safe to run on every deploy even when there's nothing new to apply.

### 17.3 Railway configuration
`railway.json`/`railway.toml` per service (`api`, `worker`): build command, start command, `/health` healthcheck path, restart policy, resource limits, and environment-variable groups (shared config vs. per-service secrets). Railway's PR/preview environments can be enabled later to give each PR its own ephemeral backend, mirroring Vercel's preview deploys for the frontend — noted as an easy upgrade, not required for launch.

### 17.4 Vercel configuration
`vercel.json`: build command, output directory, per-environment (Preview/Production) environment variables, edge middleware config for subdomain-based tenant resolution (Phase 2 §11.2), and any rewrites needed to keep API calls same-site during local/preview testing.

### 17.5 Prisma deployment workflow
Schema changes are always authored via `prisma migrate dev` locally, which generates a migration file that gets committed to the repo — `schema.prisma` is never hand-edited without a corresponding migration. CI's `migrate diff --exit-code` step is what actually enforces this (§17.2), not developer discipline alone. `migrate deploy` is the only command ever run outside a developer's machine.

### 17.6 Deployment documentation
`docs/deployment.md` covers two distinct things, clearly separated: **(a) one-time setup** — creating the Railway project/services, linking the Vercel project, provisioning the Supabase Postgres instance, creating the R2 bucket, and the full secret-provisioning checklist (every environment variable, where it comes from, which environments need it); **(b) steady-state releases** — which is simply "merge to `main`," plus the rollback procedure (Railway and Vercel both support instant redeploy of a previous build; a bad database migration is fixed by rolling forward with a new corrective migration, never by reverting a migration in place, to avoid silent data loss — stated as explicit policy here because it's the kind of thing that's obvious in the moment and easy to get wrong under pressure).

---

## 18. Plugin-oriented module architecture

"Installable without modifying existing modules whenever possible" is implemented through three concrete mechanisms, not just folder discipline:

1. **Registry-driven module loading**: `AppModule` doesn't hardcode a fixed list of module imports scattered through other modules' code — it assembles itself from a module registry (an array of `DynamicModule`s), so adding a new module is an addition to the registry, not an edit to an unrelated existing file.
2. **Event-driven integration** (Phase 2 §2.4, restated as the primary extension mechanism): a new module subscribes to existing domain events (`ProductionOrderStarted`, `QcCheckPassed`, `CustomerOrderCreated`, ...) instead of requiring the event-emitting module to know the new module exists. Example: a future "Quality Certificates" module could listen for `QcCheckPassed` and generate a certificate PDF without a single line of `QualityModule` changing.
3. **Interface-based extension points**: the places that are genuinely meant to be pluggable — AI tools (§8), storage providers (§7), notification channels (§9) — are defined as an interface plus a registration array, so a new implementation is purely additive.

Each module ships a `module.manifest.ts` (name, version, permissions it registers into the fixed catalogue, migrations it owns, enabled-by-default flag) — read at boot to assemble the app. This is the concrete artifact behind "plugin," even though it's not (yet) a truly dynamically-loadable package system.

**Honest limits, stated rather than glossed over**: Prisma's single `schema.prisma` file means each module's models live in a clearly delimited, comment-headed section of one schema rather than a genuinely separate per-module schema — a real constraint of the chosen ORM, not hidden from this document. And some additions are inherently non-zero-touch — e.g. a brand-new permission still needs one additive line in the fixed permission catalogue (Phase 2 §6). The goal is "additive, low-blast-radius" module addition — realistic for a modular monolith — not a claim that literally zero existing files are ever touched, which would require a true plugin-package-loading architecture that isn't warranted at this stage.

---

## 19. Feature flags

- **Mechanism**: a `feature_flags` table (global default + optional per-company override), served through a small `FeatureFlagsModule` (`isEnabled(flagKey, companyId?)`), Redis-cached with a short TTL. Enforced server-side via a `@RequireFlag('bom.multi-currency')` guard/decorator on routes, and exposed to the frontend via `GET /api/v1/feature-flags` fetched once at app-shell boot so the UI can hide not-yet-ready navigation and buttons.
- **Recommendation**: build this in-house rather than adopt an external paid flag-management SaaS at this stage — the requirement (ship-dark, enable-gradually, kill-switch) doesn't need experimentation/analytics tooling yet, and the interface is designed so swapping in a managed provider later is a contained change behind the same `FeatureFlagsModule` boundary, not a rewrite.
- **What this unlocks**: an unfinished module can be merged and deployed to production behind a flag, dogfooded on the owner's own company first, then rolled out company-by-company or globally — this is what makes continuous, `git push`-only delivery (§17) safe even for large, multi-week features, instead of forcing long-lived feature branches.
- **Operational use**: flags double as a kill switch — disabling a misbehaving shipped feature in production is an instant config change, not an emergency deploy.
- The Phase 4 migration engine is itself flag-gated per company (visible only to that company's admins during their migration window) — one concrete, immediate use of this mechanism.

---

## 20. API versioning & deprecation strategy

Builds on the `/api/v1/...` prefix already established (Phase 2 §4), now as a stated policy:

- **Breaking vs. non-breaking**: removing/renaming a field, changing what a status code means, or making an optional request field required is breaking and requires a new version (`/api/v2/...`); additive changes (new optional field, new endpoint, new enum value) ship into the current version without a bump.
- **Concurrent versions in one deployment**: Nest's built-in URI versioning (`@Controller({ path: 'products', version: '1' })`) lets `v1` and `v2` run side by side in the same app — no separate service or deployment needed to support an old version while a new one rolls out.
- **Deprecation signal**: a deprecated endpoint or version responds with `Deprecation` and `Sunset` HTTP headers (per the IETF draft convention), is marked deprecated in the Swagger spec, and is listed in a changelog generated from Conventional Commits (§22).
- **Support window**: minimum 6 months between marking something deprecated and removing it, for any version with real external consumers.
- **Internal consumers stay current**: the owner's own frontend (and, later, mobile clients — §23) is regenerated against the latest version as part of normal development, so deprecation windows exist primarily to protect **external API integrators** — itself a deliberate differentiator versus Odoo/Katana/ERPNext-class competitors, most of whom don't expose a clean, versioned, Swagger-documented public API. Not required for initial launch, but designed in from day one so it's available when it matters commercially.

---

## 21. Backup & disaster recovery plan (RTO/RPO)

Extends Phase 2 §15 with numeric targets — a DR plan without numbers is a description, not a plan.

**Recovery Point Objective (maximum acceptable data loss):**
| Data | RPO (primary path) | RPO (secondary/fallback path) |
|---|---|---|
| Database | ≤5 minutes (Supabase continuous WAL / point-in-time recovery) | ≤24 hours (daily `pg_dump` to R2, a different provider than the primary DB host) |
| File storage (R2) | Near-zero (R2's own durability + bucket versioning) | ≤24 hours (periodic cross-provider sync) |

**Recovery Time Objective (maximum acceptable downtime):**
| Scenario | RTO |
|---|---|
| Single API/worker pod crash | Seconds–low minutes (Railway auto-restart + healthcheck, no human action) |
| Railway or Vercel regional/provider outage | ≤1 hour, via a documented manual redeploy runbook to a backup region/provider (both tiers are stateless and redeployable from the same repo/image) — explicitly **not yet automated failover**; acceptable at launch scale, revisited as the customer base grows |
| Database corruption/data loss, primary path | ≤4 hours (PITR restore + reconciliation check, reusing the Phase 2 §12.5 verification logic) |
| Database loss, secondary path (primary backup path itself unavailable) | ≤24 hours (restore from the off-provider `pg_dump`) |
| Credential compromise | Runbook-driven secret rotation — all secrets are environment variables, rotatable without a code deploy |

- **Scenarios explicitly planned for**: accidental deletion by a bug (→ PITR to just before the incident), full loss of the Supabase project (→ restore secondary backup into a fresh Postgres instance), R2 bucket loss (→ restore from the secondary storage sync), compromised credentials (→ rotation runbook).
- **Drill cadence**: a quarterly restore drill — restore the latest backup into a scratch environment and run the same reconciliation checks used in migration verification — with the result (pass/fail, actual time taken vs. the RTO target above) logged. An untested backup is treated as equivalent to no backup; this log is what makes that untrue in practice.
- **Documentation**: `docs/disaster-recovery.md` is the runbook itself — who does what, in what order, where access/credentials live — deliberately kept **outside** the primary database and outside any single provider's dashboard, since a DR plan only readable from the system you're trying to recover is a design flaw.

---

## 22. Coding standards, architecture rules, naming conventions, commit conventions, PR requirements

- **Coding standards**: `@typescript-eslint` (strict config) + Prettier, `strict: true` in every `tsconfig.json`, `no-explicit-any` as a build-breaking error (the concrete enforcement of requirement #8) — run via a pre-commit hook (`husky` + `lint-staged`) *and* again in CI, since CI is the actual gate; local hooks alone are a courtesy, not a guarantee.
- **Architecture rules, lint-enforced, not just documented** (via `eslint-plugin-boundaries` or equivalent module-boundary tooling): a module's controller is only reachable through its own routing; a module's Prisma repository is only used by that module's own service; cross-module interaction goes through another module's exported service or a domain event, never direct repository access (Phase 2 §2.2) — enforced by a rule that fails CI, so it survives team turnover rather than depending on institutional memory.
- **Naming conventions** (documented with real examples from this domain in `docs/conventions.md`, not generic placeholders): `kebab-case` filenames, `PascalCase` classes/types, `camelCase` variables/functions; Prisma models `PascalCase` singular (`ProductionOrder`) mapped to `snake_case` plural tables (`@@map("production_orders")`).
- **Commit conventions**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`), enforced via `commitlint` in a git hook — this is also what drives automated changelog generation, which the API deprecation notices (§20) depend on.
- **PR requirements**: a template requiring a linked task, a what/why description, and a checklist (tests added, Swagger updated, migration included if the schema changed, no new `any`); minimum one review approval; CI fully green (lint, typecheck, tests, migration-diff, contract-diff) as a hard, branch-protection-enforced merge gate — not a social convention anyone can skip under deadline pressure.
- **Documentation-as-you-go**: any PR touching an endpoint must update its Swagger decorators in the same PR, mechanically enforced by the contract-diff CI check (§2.5/§4/§17.2) — this exists specifically so the new system's docs never drift the way `README.md` drifted from the actual Apps Script code (Phase 1 §10.11 is the concrete cautionary example behind this rule).

---

## 23. Mobile-readiness (Flutter / React Native)

Not a mobile build — a constraint on today's architecture so a mobile app is a client-only project later, requiring zero backend changes:

- **Hard rule, already true by construction and restated explicitly here**: all business logic lives in the NestJS API; the Next.js frontend contains presentation and formatting only (Phase 2 §3.2's "the client is thin, the server is authoritative" principle, elevated from a frontend design note to a cross-cutting architecture rule, lint-checked alongside §22's boundary rules where practical).
- **API contract is client-agnostic**: the same versioned REST API + OpenAPI spec that generates the web's typed TypeScript client (§3.3) generates a Dart client for Flutter (`openapi-generator`) or is consumed directly by a TypeScript client if React Native is chosen instead — no parallel "mobile API" to build or keep in sync.
- **Auth already mobile-compatible**: bearer access tokens work identically for a mobile client; the httpOnly-cookie refresh-token transport (§5) is web-specific, but the same refresh endpoint validates a refresh token value regardless of transport, so a mobile client stores its refresh token in secure device storage (Keychain/Keystore) and calls the identical endpoint.
- **File upload/download** (presigned URLs, §7) and **AI assistant** (§8) work unchanged from a mobile client — no server-side branching by client type anywhere.
- **The one genuinely new capability a mobile app would need**: push notifications. `NotificationsModule` is already channel-abstracted (email today per §9), so adding a push channel later is additive, not a redesign.
- No Flutter/React Native work is in scope now — this section exists purely to make sure nothing built in Phases 3–8 quietly forecloses it.

---

## 24. Horizontal scaling without code changes

Consolidates and states as an explicit guarantee what Phase 2's earlier decisions already add up to (§13, §16):

- The API tier is fully stateless — no in-memory session or cache (sessions/rate-limits/cache live in Redis) — so running N replicas is a **configuration change** (replica count on Railway), not a code change. This holds specifically because of: JWT-based auth (no sticky-session requirement), Redis-backed shared state, a connection pooler in front of Postgres that tolerates many concurrent short-lived connections from many pods (§16), and background jobs already isolated onto an independently-scaled worker tier (§9, §17.1).
- **Stated honestly, not oversold**: this guarantees *tier-level* horizontal scaling without code changes. It does not automatically give one enormous tenant dedicated, isolated resources — the multi-tenant design (§11) provides logical isolation, but true physical/dedicated-resource isolation for a very large customer would be a deliberate future feature, not something that falls out of this architecture for free.
- **The one tier that can't just add replicas**: Postgres writes. The documented long-term watch items are partitioning readiness (already designed for, §16) and, if real load ever demands it, read/write splitting — neither is a launch-day concern at the current target scale, and neither requires an application rewrite when the time comes, because the schema (Phase 3) is designed not to preclude them.

---

## 25. Architecture Decision Records (ADR)

- `docs/adr/` — one markdown file per decision, sequentially numbered (`0001-modular-monolith-not-microservices.md`, `0002-multi-tenant-shared-schema-with-rls.md`, ...), fixed template: **Status** (proposed / accepted / superseded), **Context**, **Decision**, **Consequences**, **Alternatives considered**.
- Every judgment call already flagged as a "recommendation" throughout this document — and there have been many, by design, so they're visible rather than silently baked in — becomes its own numbered ADR at the start of Phase 3. This is the concrete traceability mechanism: a future engineer (or future you) asking "why shared-schema-RLS and not schema-per-tenant" finds a written, dated answer, not a memory nobody has anymore.
- **New ADRs are a PR checklist item (§22)** whenever a decision meaningfully reverses or supersedes a previous one — e.g., if a module is ever extracted from the monolith into its own service, that gets its own ADR explicitly superseding ADR-0001's stated boundary, rather than the change happening silently.
- **Initial ADR backlog**, to be written at the start of Phase 3 since several of these directly inform schema design: modular monolith vs. microservices; shared-schema-with-RLS multi-tenancy vs. schema-per-tenant/db-per-tenant; NestJS + Prisma + PostgreSQL stack selection; Cloudflare R2 vs. S3; BullMQ + Redis for background jobs; JWT + rotating refresh tokens vs. server-side sessions; build-vs-buy for feature flags; URI-path API versioning vs. header-based versioning.

---

## 26. Complete development roadmap

Strictly phase-gated, per your instruction — nothing below starts until the phase before it is approved and, where noted, actually complete.

1. **Phase 2 (this document, including the §17–25 revision)** → your approval.
2. **Phase 3 — PostgreSQL schema**: opens with the initial ADR backlog (§25) since several decisions directly inform the schema, then the full `schema.prisma` for every entity in the Phase 1 data dictionary (normalized, with the 5 JSON-blob columns expanded into real tables, feature-flag and audit tables per §19/§10.5 included), RLS policies, indexes, seed script (default roles/permissions, default units/stages/QC-checklist per new company) → approval.
3. **Phase 4 — Migration engine**: extract/transform/load/verify scripts per §12, exercised in a full dry run against a scratch DB with a real reconciliation report reviewed by you → approval. The *real* cutover run happens only when you're ready to freeze the live Apps Script system, not automatically at the end of this phase.
4. **Phase 5 — Backend, module by module.** Recommended build order (foundation-first, each module shipped with tests + Swagger docs, verified against Phase 1 behavior before moving on):
   1. `TenancyModule` + `IdentityModule` + `AuthorizationModule` (nothing else can be built or tested without tenancy/auth existing first)
   2. `AuditModule` + `FilesModule` (cross-cutting infrastructure every later module depends on)
   3. `CatalogModule` (products) + `SettingsModule` (units, VAT, branding)
   4. `InventoryModule` (warehouses, stock movements, inventory sessions)
   5. `BomModule` (assemblies, versioning, cost calc)
   6. `ProductionModule` + `QualityModule` (the reserve→start→QC chain)
   7. `ProcurementModule` (suppliers, purchase orders)
   8. `SalesModule` (customer orders, shortage analysis, shipments)
   9. `HrModule` (employees, payroll)
   10. `ReportsModule` (depends on everything above existing to report on)
   11. `AiModule` (depends on the domain modules it queries existing first)
   12. `NotificationsModule` (digest email; Telegram rebuild deferred per Phase 0)
   13. `BillingModule` stub (plan/company fields only, no live Stripe integration yet)
5. **Phase 6 — Frontend, module by module**, mirroring the backend order, starting with the authenticated shell + dashboard, so every subsequent module has a real place to land in the UI as it ships.
6. **Phase 7 — Testing hardening**: full tenant-isolation suite (§11.4), load testing against the "thousands of companies" scale target, security review (dependency audit, auth flow penetration-style review).
7. **Phase 8 — Deployment & cutover**: staging soak, first real customer (your own business) migration per Phase 4's process, monitoring/alerting live, then general availability.
8. **Post-launch, explicitly out of initial scope**: Telegram bot rebuilt on a real webhook, live Stripe billing, additional locale content beyond scaffolding, and re-evaluating any module for extraction out of the monolith if its real load demands it.
