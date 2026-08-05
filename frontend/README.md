# SH ERP — Frontend

Next.js 14 (App Router) frontend for SH ERP v2, built module-by-module mirroring the backend's Phase 5 roadmap (see `backend/README.md` and `docs/architecture/phase-2-architecture.md` §26). The backend (all 12 modules) is complete and frozen for contract purposes — this frontend consumes it as-is; nothing here changes a backend route, DTO, or response shape.

## Status

**All frontend tasks complete: 41-52.** Scaffold, auth + shell + dashboard, Catalog + Settings, Inventory, BOM, Production + QC, Procurement, Sales, HR, Reports, AI, and Notifications + Billing. Every module in the Phase 2 §26 roadmap now has a working frontend against the frozen backend contracts. See "What's next" below for what's deliberately NOT built (real Stripe checkout, real digest scheduling, tenant branding in the shell chrome) — this is a complete v1 frontend, not a finished product.

**Production-readiness pass, added after Task 52:** an `/admin` section (Users | Roles | Audit Log tabs) against the backend's new `UsersModule`/`RolesController`/audit-events exposure — see "Directory layout" below for the new routes and `lib/api-client/{users,roles,audit}.ts` for the client. This closes the "invite additional users" gap flagged as missing during the end-to-end production readiness review.

**Same pass, second shipped item (owner's explicit priority #1 of 4 secondary features)**: Excel bulk import/export on the Catalog page. "Import from Excel"/"Export to Excel" buttons on `/catalog` — import via a real multipart upload (`apiClient.postFile`, a new transport alongside the existing R2-presign flow, see `http.ts`'s header comment for why), export via a binary download (`apiClient.getBlob` + an object-URL anchor click, no new dependency needed). See "Directory layout" and the api-client section below for the new files.

**Same pass, third shipped item (owner's priority #2 of 4)**: document/label printing — pick lists, assembly specs, customer order documents, supplier purchase requests, product labels. Legacy (`printHtmlInNewWindow_`, `JavaScript.html`) opened a new browser tab and `document.write()`'d a standalone print-styled HTML page, then called `window.print()`. This app keeps the "browser's native print dialog does the PDF work" approach (no new backend PDF-generation dependency) but renders the printable markup inline instead of in a popup — `components/domain/print/print-area.tsx`'s `<PrintArea>`/`<PrintButton>`, plus a `@media print` block added to `globals.css` (the app is dark-themed everywhere else; this is the one place with an explicit light-mode override) that hides everything on the page except `.print-area`'s subtree. Five print views, one per legacy document type, each wired into the existing page that already has the relevant data loaded (no new backend endpoints):
- `components/domain/production/pick-list-print.tsx` — production order detail (`/production/[id]`)
- `components/domain/bom/assembly-spec-print.tsx` — BOM components tab (`/bom/[id]/components`)
- `components/domain/sales/customer-order-print.tsx` — customer order detail (`/sales/[id]`)
- `components/domain/sales/supplier-requests-print.tsx` — shortage preview (`/sales/[id]/shortage`)
- `components/domain/catalog/product-labels-dialog.tsx` — new "Print labels" button on `/catalog`, a self-contained product search + copies-per-product picker (deliberately not built on `DataTable`, which has no row-selection support — see that file's header comment)

**Two real, disclosed scope boundaries versus the legacy documents, found while reading `ProductionOrders.gs`/`ImportExport.gs`'s HTML templates before building**: (1) the legacy warehouse pick/issue sheet showed article, internal code, bin/cell location, and consumed serial numbers per line; this backend's `ProductionOrderPickListItem` only carries a free-text `description`/`qty`/`unitPriceEur`/`lineTotalEur` (confirmed from `lib/api-client/production.ts`) — the print view shows exactly what the order detail page already renders on screen, not a richer sheet that would need a new backend field. (2) Neither `CustomerOrderItem` nor `ShortageLine` carry a unit price/line total or a photo anywhere in this data model (confirmed against both api-client files) — the customer order and supplier-request print views omit pricing/photos rather than fake them, unlike the legacy sheets' admin-only priced columns. Both are flagged in each component's own header comment, not silently degraded. Assembly/customer-order line items DO get their names resolved (`useProduct`/`useAssembly` per line) rather than printing a raw UUID — worth the extra query since a printed document handed to someone off-screen showing a bare id would be a real regression, unlike the on-screen "known simplification" tables this same raw-id pattern is tolerated in elsewhere.

No real barcode symbology (Code128/EAN) exists in the legacy system either — `Labels.gs`'s own header comment confirms it used to generate QR codes and was deliberately replaced with plain-text article printing after in-browser scanning proved unreliable. The label print view preserves that exact convention rather than introducing a new barcode dependency.

**Same pass, fourth shipped item (owner's priority #3 of 4)**: a dense inline-editable spreadsheet/grid view of Products (`/catalog/grid`, linked from the main `/catalog` page), ported from legacy's "Таблиця товарів" (`spreadsheet.html`/`JavaScript.html`'s `SS_COLUMNS`/`ssCellChanged_`/etc. — an admin-editor whose whole design assumed a low-hundreds product count: zero pagination, zero virtualization, the entire catalog loaded into one table on every visit, confirmed by grepping the legacy source for any limit/offset/performance-related code and finding none). `components/domain/catalog/product-grid-columns.ts` holds the column config (pure data + the pure `filterProductsByFieldValues`/`distinctFieldValues` helpers, unit tested) and `app/(app)/catalog/grid/page.tsx` the page itself: per-cell `onBlur` save (text/number columns PATCH the single field via the existing `updateProduct`; the `qty` column is special-cased through `recordStockMovement` as an `ADJUST` delta against the company's default warehouse, never a direct `Product.qty` write — the same atomic-ledger rule Excel import already established), client-computed filter dropdowns + AND-combination, a jump-to-row search, a column-visibility toggle (in-memory only, resets on reload, matching legacy exactly), and select-mode bulk delete.

**Three real, disclosed scope boundaries versus legacy, all found while reading `JavaScript.html`'s spreadsheet section in full before building** — see `product-grid-columns.ts`'s own header comment for the first, `app/(app)/catalog/grid/page.tsx`'s for the other two: (1) `unit` is a real `<select>`-backed FK column now, not free text — the schema requires a `CompanyUnit` id (Phase 3 decision 1), and legacy's `SS_COLUMNS` never had a `select` column type at all, so this is a necessary addition, not a UX embellishment; no photo column (`Product` has none) and no `usedInAssemblies` readonly column (no backend endpoint computes it) — both dropped, not faked. (2) No `getFilterOptions`-equivalent endpoint exists — filter dropdown option lists are computed client-side from whatever page of products is already loaded, rather than fetched from a dedicated server call. (3) This backend's product-list endpoint caps at 200 rows per request (`QueryProductsDto`'s own limit); the grid inherits that ceiling rather than fighting it with new pagination UI, flagged as a real v1 boundary for a company with a larger catalog. (4) Bulk delete is `Promise.allSettled` over the existing single-item `DELETE /products/:id` (already idempotent soft-delete), not a new batch backend endpoint — legacy had a dedicated `deleteProductsBulk` RPC; adding an equivalent batch endpoint for one grid feature wasn't judged worth a new API surface.

Tenant branding (logo override in the shell chrome itself, e.g. topbar) is still **not** wired in — see "Known gap: pre-login branding images" below for why this turned out to be more than a UI task.

## Stack

- **Next.js 14, App Router.** `app/(public)/` — unauthenticated routes (login, register). `app/(app)/` — authenticated shell + one route segment per backend module. `app/api/` — Next.js-owned route handlers only, for the few things Next must own itself (httpOnly-cookie auth proxying; later, file-upload presign proxying if needed). No business logic lives in `app/api/` — it's a thin proxy, the NestJS backend stays authoritative.
- **Data fetching:** TanStack Query, called from Client Components via `lib/api-client/http.ts`. See "Why data fetching is client-side" below.
- **Client UI state:** Zustand (`lib/auth/session-store.ts` for the in-memory access token; small per-feature stores as later modules need them).
- **Styling:** Tailwind + hand-written shadcn/ui-style primitives (`components/ui/`). Dark theme + purple accent, values as CSS variables in `app/globals.css`, structured so a per-company override could set `--primary` etc. at the shell layout level without a rebuild — not yet wired to real data, since `CompanyBranding` currently only has logo/favicon file references, no accent-color column (see "Known gap" below).
- **i18n:** `next-intl`. `uk` is the complete, default catalogue (the legacy Apps Script system was Ukrainian-only); `en`/`pl`/`de` are scaffolded placeholders under `messages/`.
- **Validation:** `zod` + `react-hook-form` + `@hookform/resolvers` for forms.

## Disclosed deviations from Phase 2 §3 (all intentional, none silent)

1. **Repo path is `frontend/`, not `apps/web/`.** Matches the flat-repo convention already established by `backend/` (also not under `apps/api/`).
2. **Locale is a cookie, not a URL segment.** Phase 2 §3.1 specifies `app/(public)/` + `app/(app)/` route groups; nesting everything under `app/[locale]/...` as next-intl's routed-i18n mode wants would fight that grouping and put a locale prefix in every URL of a system whose tenancy is already resolved by company slug, not locale. Locale is instead resolved server-side from a `sh_locale` cookie (`i18n.ts`, next-intl's documented "without i18n routing" mode) with `uk` as the fallback. A language switcher writing that cookie is a small piece of later shell work.
3. **Data fetching is client-side (TanStack Query in Client Components), not Server Components fetching from the backend directly.** The access token is deliberately in-memory-only (Zustand, never localStorage, never a JS-readable cookie — see `lib/auth/session-store.ts`), which means it does not exist during a Server Component render. Server Components are still used for static/layout chrome; anything requiring the bearer token goes through `apiClient` from a Client Component. This preserves the "client is thin, server [NestJS] is authoritative" principle from §3.2 — it's about where business logic lives, not which React component type issues the fetch.
4. **The typed API client is hand-authored, not generated.** Phase 2 §3.3 specifies generating a client from the Swagger spec (orval/openapi-typescript-codegen). The backend cannot currently run `prisma generate` in this sandbox (confirmed 403 from `binaries.prisma.sh`), so there is no live Swagger JSON to generate against here. Each typed function/DTO under `lib/api-client/` is instead hand-copied field-for-field from the real backend controller/DTO source (cited in a comment at the top of each file), structured so swapping in a real generated client later is a drop-in replacement, not a rewrite. This must be re-verified against the generated client once `prisma generate` can run for real. **A real mistake this caught itself out on**: `lib/api-client/auth.ts`'s `CompanyBranding` type was initially hand-guessed (`logoUrl`/`faviconUrl`/`accentColor`) instead of read from the actual `CompanyBranding` Prisma model, which only has `siteLogoFileId`/`printLogoFileId`/`faviconFileId` (FileAsset references, not URLs). Caught and fixed while building the real branding settings UI in Task 43 — worth remembering as a concrete illustration of why every hand-authored type here is a genuine risk, not just a formality, and should be checked against schema.prisma/the real DTO, not inferred from a plausible-sounding field name.

## Prisma `Decimal` fields are JSON strings, not numbers

`Product.qty`/`minQty`/prices, `CompanySettings.vatRatePercent`, and every other `@db.Decimal(...)` column in schema.prisma serialize to JSON as **strings** (`Decimal.prototype.toJSON` returns `.toString()`; NestJS's default Express JSON serializer doesn't touch this). `lib/api-client/decimal.ts`'s `DecimalString` type alias and `toNumber()`/`toDecimalInput()` helpers exist specifically so this isn't silently forgotten module after module — every `*.ts` file under `lib/api-client/` that has a Decimal-backed field types it as `DecimalString`, never `number`, and every form that edits one goes through `toNumber()` to populate the input and sends a plain JS number back (the DTO's `@Type(() => Number)` on the backend handles the reverse conversion). `product-form.tsx` is the reference implementation to copy from for any later module with Decimal fields.

**Exception, found while building BOM, worth remembering**: not every numeric field from the backend is a `DecimalString`. `Assembly`/`AssemblyComponent` rows (from the plain CRUD endpoints — create/update/findOne/getComponents/getVersions) are Prisma rows, so their Decimal fields (`laborCostPerUnit`, `qtyPerUnit`, etc.) follow the string convention as usual. But `GET /assemblies/:id/cost`, `POST /assemblies/:id/check-availability`, and `POST /assemblies/:id/produce` return *computed* results built from `Number(...)` arithmetic inside `assemblies.service.ts`, not Prisma rows straight off the wire — those fields (`localCostPerUnit`, `needed`, `available`, etc.) are real JSON numbers. `lib/api-client/bom.ts`'s header comment flags exactly where the split happens; worth checking against the real service method (not just the DTO) for any future module that mixes raw CRUD with a computed-result endpoint.

## Auth flow (why cookies are Next.js's job, not the backend's)

`backend/src/modules/identity/auth.service.ts` confirmed: `login()` and `refresh()` return `{ accessToken, refreshToken, expiresIn, userId, companyId }` directly in the JSON body — the backend never sets a cookie itself. Access tokens are short-lived JWTs (~15 min); refresh tokens are opaque, rotate on every use, and the whole rotation family is revoked on reuse-detection (backend-owned, not re-implemented here).

So this app owns cookie storage itself:
- `app/api/auth/login/route.ts`, `refresh/route.ts`, `logout/route.ts` call the backend, then set/clear four **httpOnly, Secure (in production), SameSite=Lax** cookies via `lib/auth/server-cookies.ts` (names in `lib/auth/cookie-names.ts`): the refresh token itself, plus `userId`/`companyId`/`companySlug`. The latter three exist only because `auth.service.ts#refresh()` deliberately returns just `{accessToken, refreshToken, expiresIn}` — no identity fields (only `login()` returns those) — so the refresh route re-derives them from the cookies set at login rather than the backend response.
- The **access token is never put in a cookie.** It's returned to the browser in the JSON response of our own `/api/auth/*` routes and held only in the Zustand store (`lib/auth/session-store.ts`) for the life of the tab.
- `lib/api-client/http.ts` attaches the in-memory access token as a Bearer header on every backend call, and on a `401` calls our own `/api/auth/refresh` once (same-origin, cookie rides along automatically) before giving up and clearing the session.
- `middleware.ts` gates the authenticated route segments by checking **presence** of the refresh cookie only — it cannot validate it (that needs a DB round-trip the backend owns). An expired/revoked cookie still passes the middleware gate and is rejected on the first real API call.
- `components/domain/shell/session-boundary.tsx` is the client-side counterpart: on first mount under `app/(app)/layout.tsx` it calls `restoreSession()` to silently exchange the httpOnly cookie for an access token (necessary after every page reload/new tab, since the access token itself never persists), and redirects to `/login` if that fails.

## Known gap: pre-login branding images (found while building Task 43, not silently worked around)

`auth.controller.ts#getPublicCompanyInfo` (the `@Public()` endpoint the login screen calls) returns the company's `CompanyBranding` row, which only ever contains `FileAsset` **ids** (`siteLogoFileId` etc.), never a usable URL. Getting an actual image URL requires `GET /files/:id/download-url`, and that endpoint carries `@RequirePermissions('files:read')` — i.e. it needs an authenticated bearer token. So there is currently no way for the public, pre-login `/login` screen to actually render a company's logo, even though the public-info endpoint hands back the file id as if it could. This is a real gap in the backend's public surface (a `download-url` route needs either its own `@Public()` variant gated on `FileAsset.isPublic`, or the public-info endpoint needs to return a resolved URL directly), not something to patch around client-side. Flagged here rather than building a login-page logo that silently never renders.

Inside the **authenticated** shell this isn't a problem (the user already has a bearer token), so wiring `CompanyBranding.siteLogoFileId` into the topbar via `getFileDownloadUrl()` is still straightforward future work — just not done yet, and no longer blocked on anything, now that `lib/api-client/settings.ts` and `files.ts` both exist. Worth picking up as a small polish item whenever the shell gets revisited, e.g. alongside the accent-color override design mentioned in the theming section above (which also has no backend field yet — `CompanyBranding` has no accent-color column at all, only logo/favicon file references — so a full "override `--primary` per company" feature needs a schema decision, not just frontend wiring).

## Directory layout so far

```
frontend/
  app/
    layout.tsx           — root layout: locale resolution, NextIntlClientProvider, Providers
    page.tsx              — redirects to /dashboard (middleware handles the auth bounce)
    providers.tsx          — TanStack QueryClientProvider (client component)
    globals.css            — theme CSS variables
    (public)/
      layout.tsx            — centered card shell for login/register
      login/page.tsx
      register/page.tsx
    (app)/
      layout.tsx            — authenticated shell: SessionBoundary + Sidebar + Topbar
      dashboard/page.tsx
      catalog/
        page.tsx              — products grid (search + pagination); production-readiness pass added
                                   Import/Export buttons (components/domain/catalog/import-products-dialog.tsx,
                                   lib/hooks/use-catalog.ts#useImportProducts/useExportProducts)
        new/page.tsx           — create product
        [id]/page.tsx           — edit/delete product
        units/page.tsx          — CompanyUnits management
        grid/page.tsx            — dense inline-editable spreadsheet/grid view (production-readiness
                                     pass) — see components/domain/catalog/product-grid-columns.ts
      settings/page.tsx       — company settings (VAT/digest) + branding (logo/favicon upload)
      inventory/
        layout.tsx              — shared tab bar (Stock levels | Movements | Warehouses | Stocktakes)
        page.tsx                 — stock levels + Record movement / Move stock dialogs
        movements/page.tsx        — stock movement history, paginated
        warehouses/page.tsx        — Warehouse CRUD
        sessions/page.tsx           — stocktake list + start-new dialog
        sessions/[id]/page.tsx        — stocktake detail: count entry, complete
      bom/
        page.tsx                     — assemblies grid (search + pagination)
        new/page.tsx                  — create assembly (header fields only; BOM lines added after)
        [id]/
          layout.tsx                    — shared tab bar (Header | BOM | Cost | Availability & produce | Versions) + delete
          page.tsx                       — edit assembly header
          components/page.tsx             — BomEditor (add/edit/remove BOM lines, save = new version)
          cost/page.tsx                    — recursive cost breakdown (local + German)
          availability/page.tsx             — check-availability + produce, with shortage table
          versions/page.tsx                  — version list
          versions/[versionId]/page.tsx       — one immutable version's BOM lines
      production/
        layout.tsx                     — shared tab bar (Orders | Stages | Finished goods | QC checklist)
        page.tsx                        — order list (filter by status, paginated)
        new/page.tsx                     — create order: AssemblyPicker, unitsPlanned, comment, WorkerEditor
        [id]/page.tsx                     — order detail: status-conditioned lifecycle actions (PLANNED: edit
                                              workers/cancel/start; IN_PROGRESS: stage tracker + advance-stage),
                                              cost breakdown, pick list, stage event history, finished goods
        stages/page.tsx                   — ProductionStage CRUD, up/down reorder (no drag lib in deps, see
                                              bom-editor.tsx/warehouses page for the same constraint)
        finished-goods/page.tsx            — finished goods list (filter by status, paginated)
        finished-goods/[id]/page.tsx        — serial detail + QC check history + record-check form
        qc-checklist/page.tsx               — QcChecklistItem CRUD (add/delete)
      procurement/
        layout.tsx                     — shared tab bar (Purchase orders | Suppliers)
        page.tsx                        — purchase order list (filter by status, paginated)
        new/page.tsx                     — create PO: SupplierPicker + free-text supplierNameSnapshot
                                             (independent fields, see supplier-picker.tsx), item lines with
                                             ProductPicker (optional link) + article/name snapshot + qty/price
        [id]/page.tsx                     — PO detail: items table + inline receive-delivery form (per-line
                                              qty-received delta + actualPrice, optional warehouse override)
        suppliers/page.tsx                 — supplier list (search + pagination)
        suppliers/new/page.tsx              — create supplier
        suppliers/[id]/page.tsx              — edit supplier + soft-delete
      sales/
        layout.tsx                     — shared tab bar (Customer orders | Shipments)
        page.tsx                        — customer order list (status filter + client search, paginated)
        new/page.tsx                     — create order: header fields + AssemblyPicker item-line rows
        [id]/page.tsx                     — order detail: cancel/complete lifecycle actions, per-line
                                              give-to-production + give-all-to-production, link to shortage
        [id]/shortage/page.tsx             — recursive shortage preview grouped by supplier (needed vs.
                                               current stock shown side by side, never netted — "no hidden
                                               arithmetic"), editable qty-to-order per line, commits to
                                               one PurchaseOrder per group
        shipments/page.tsx                 — shipment list (status filter, paginated)
        shipments/new/page.tsx              — create shipment: optional CustomerOrderPicker link +
                                                FinishedGoodSelector (IN_STOCK units only, filterable by
                                                assembly) + carrier/waybill/package fields
        shipments/[id]/page.tsx              — shipment detail: markDelivered / delete (not-yet-delivered
                                                 only — delete reverts finished goods back to IN_STOCK)
      hr/
        layout.tsx                     — shared tab bar (Employees | Payroll)
        page.tsx                        — employee list (status filter defaulting to ACTIVE, search, paginated)
        new/page.tsx                     — create employee
        [id]/page.tsx                     — edit employee + deactivate/reactivate (never a hard delete —
                                              see lib/api-client/hr.ts header comment)
        payroll/page.tsx                   — record a manual ADVANCE/BONUS/PENALTY ledger entry (positive
                                               magnitude only — the backend applies the sign) + filterable
                                               ledger table + link to the summary report
        payroll/summary/page.tsx            — per-employee totals by type + QC-defect cross-reference,
                                                optional from/to date range
      reports/
        layout.tsx                     — shared tab bar (Reorder suggestions | Warehouse valuation | Monthly production)
        page.tsx                        — reorder suggestions (qty - reserved < 2x minQty, worst shortfall
                                              first; already resolved to article/name server-side, no
                                              raw-id gap here unlike most other list views)
        valuation/page.tsx                — warehouse valuation by category + grand total row (admin-only,
                                              reports:valuation)
        production-rollup/page.tsx          — COMPLETED production orders grouped by assembly, optional
                                                from/to date range (defaults to the current month)
      ai/
        layout.tsx                     — shared tab bar (Help | Full assistant | Order Q&A | Invoice
                                             recognition | Settings)
        page.tsx                        — help assistant ("Довідник"): single-turn, zero live-data access,
                                              answers strictly from the built-in manual (AskHelpDto has no
                                              history field at all — this is by backend design, not a
                                              frontend simplification)
        order-qa/page.tsx                — single-turn Q&A over one CustomerOrderPicker-selected order's
                                              real data, same no-history contract as the help assistant
        full-assistant/page.tsx           — the function-calling assistant: multi-turn chat, an opaque
                                              historyJson string round-tripped verbatim between calls (not
                                              reconstructed from the rendered message list — see the page's
                                              own header comment), optional image/PDF attachment read via
                                              FileReader, and a PendingConfirmationCard shown whenever a
                                              response carries pendingConfirmation. Production-readiness pass
                                              added voice mode: a mic button (feature-detected, hidden if the
                                              browser lacks SpeechRecognition) transcribes speech into the
                                              question textarea via lib/hooks/use-speech.ts, and an optional
                                              TTS toggle (off by default, feature-detected separately) reads
                                              each assistant answer aloud via speechSynthesis — both are a pure
                                              input/output layer around the unchanged askFullAssistant
                                              text-in/text-out contract, not a new backend capability
        invoice/page.tsx                   — supplier invoice photo → structured line items fuzzy-matched
                                               against Products; reads the file via FileReader into base64
                                               itself, does NOT use FileUploadField (the backend wants the
                                               image inline for a multimodal call, never persists it as a
                                               FileAsset — see lib/api-client/ai.ts header comment)
        settings/page.tsx                   — bring-your-own Gemini API key (write-only — GET never returns
                                                it, only hasCustomApiKey) + monthly token quota
      notifications/page.tsx           — low-stock digest preview + on-demand send-now (no schedule UI —
                                            there is no automatic daily send wired up anywhere in the
                                            backend yet, see lib/api-client/notifications.ts header comment)
      billing/page.tsx                  — current subscription + plan cards with a switch-plan action
                                             (Phase 0 stub — records the change, collects no payment)
      admin/
        layout.tsx                        — shared tab bar (Users | Roles | Audit Log)
        page.tsx                           — company members list, inline role-change select, invite-user
                                               dialog (shows the one-time temp password when a brand-new
                                               account is created), remove-access two-step confirm (disabled
                                               for yourself — the backend also blocks this server-side)
        roles/page.tsx                      — role cards grid, create/edit dialog with permission checkboxes
                                               grouped by resource, two-step confirm delete (hidden for
                                               isSystem roles, matching the backend's own delete guard)
        audit/page.tsx                       — filterable (entityType, action), paginated audit event table
    api/auth/
      login/route.ts        — proxies backend /auth/login, sets httpOnly cookies
      refresh/route.ts       — proxies backend /auth/refresh, rotates cookies
      logout/route.ts         — proxies backend /auth/logout, clears cookies
  components/
    ui/                     — hand-written shadcn-style primitives: button, input, label, card,
                                textarea, badge, select, dialog, table
    domain/
      shell/                  — session-boundary, sidebar, topbar
      data-table/               — DataTable: shared @tanstack/react-table grid + pagination controls,
                                   used by every module's list view from Catalog onward
      files/                     — FileUploadField: presign→PUT→confirm upload widget, reused by
                                    branding now and by every later module with photo/document attachments
      catalog/                    — product-form.tsx (shared by new/[id] pages), product-picker.tsx
                                     (typeahead product search — reused by Inventory's movement dialogs
                                     and BOM's line editor; will be reused by Production/Procurement/Sales),
                                     import-products-dialog.tsx (production-readiness pass — plain
                                     `<input type="file" accept=".xlsx">`, not FileUploadField, since this
                                     is a one-shot server-parsed upload with no FileAsset/entityId to attach
                                     to yet, see lib/api-client/catalog.ts#importProducts's header comment),
                                     product-labels-dialog.tsx (production-readiness pass — label printing,
                                     see print/ above; exports the pure expandLabelCopies() helper, unit
                                     tested in the sibling .test.ts without mounting the dialog),
                                     product-grid-columns.ts (production-readiness pass — spreadsheet/grid
                                     view column config + pure filter helpers, backs app/(app)/catalog/grid/)
      inventory/                    — record-movement-dialog.tsx, move-stock-dialog.tsx
      bom/                            — assembly-form.tsx, bom-editor.tsx (line editor: add/remove/edit
                                         rows, PRODUCT rows use ProductPicker, ASSEMBLY rows use the new
                                         assembly-picker.tsx sibling), assembly-picker.tsx,
                                         assembly-spec-print.tsx (production-readiness pass, see print/ above —
                                         resolves each component's productId/subAssemblyId to a real name via
                                         useProduct/useAssembly per line rather than printing the raw id)
      hr/                               — employee-picker.tsx: typeahead picker (originally built in Task 46
                                           to power Production's worker assignment; see lib/api-client/hr.ts
                                           header comment). employee-form.tsx: shared by hr/new and hr/[id],
                                           same pattern as supplier-form.tsx
      production/                        — worker-editor.tsx: same rows-with-picker pattern as bom-editor.tsx,
                                             for editing ProductionOrderWorker[] (percentages need not sum
                                             to 100 client-side — normalized server-side at start()),
                                             pick-list-print.tsx (production-readiness pass, see print/ below)
      print/                              — print-area.tsx (production-readiness pass): <PrintArea>/<PrintButton>/
                                             <PrintDocumentHeader>, the shared scaffolding every print view
                                             (pick list, assembly spec, customer order, supplier requests,
                                             product labels) is built on — see globals.css's @media print block
      procurement/                         — supplier-picker.tsx (fourth typeahead-picker sibling; only
                                               sets supplierId, never auto-overwrites the independent
                                               supplierNameSnapshot text field it's paired with),
                                               supplier-form.tsx (shared by suppliers/new and suppliers/[id])
      sales/                                 — customer-order-picker.tsx (fifth typeahead-picker sibling,
                                                 used to optionally link a Shipment to its CustomerOrder),
                                                 finished-good-selector.tsx (multi-select checklist of
                                                 IN_STOCK finished goods for shipment creation, filterable
                                                 by assembly via AssemblyPicker — not a picker itself, no
                                                 free-text search exists on GET /finished-goods),
                                                 customer-order-print.tsx + supplier-requests-print.tsx
                                                 (production-readiness pass, see print/ above)
      ai/                                     — pending-confirmation-card.tsx: renders a PendingConfirmation
                                                 (action/args/description) with Confirm/Cancel buttons wired
                                                 to confirmAiAction/cancelAiAction; the only place in this
                                                 module a critical tool call can actually be executed
  lib/
    utils.ts                 — cn() class-merge helper
    api-client/
      http.ts                 — browser-only fetch wrapper: Bearer header, 401→refresh→retry-once
      types.ts                 — ApiError, shared request option types
      decimal.ts                 — DecimalString type + toNumber()/toDecimalInput() (see below)
      auth.ts                     — signupCompany(), getPublicCompanyInfo() (the two pre-token @Public() routes)
      catalog.ts                   — Product + CompanyUnit CRUD; production-readiness pass added
                                       importProducts()/exportProducts() — the first two api-client
                                       functions in this app that DON'T go through apiClient.get/post/
                                       patch/delete's JSON path (see http.ts's new postFile()/getBlob())
      settings.ts                   — CompanySettings + CompanyBranding
      files.ts                       — presigned-upload orchestration, download URLs, entity file listing
      inventory.ts                    — Warehouse CRUD, stock movements/levels/history, inventory sessions
      bom.ts                            — Assembly CRUD, BOM lines + versions, cost/availability/produce
                                           (see the DecimalString-vs-plain-number split noted below)
      hr.ts                               — minimal read-only Employee slice (queryEmployees/getEmployee);
                                             grows into the full HR api-client in Task 49, not replaced
      production.ts                        — ProductionOrder lifecycle, ProductionStage CRUD+reorder,
                                               FinishedGood query, QcChecklistItem CRUD, QC check
                                               record/history — all Prisma-row endpoints, no computed-result
                                               split like BOM's (start()'s response is a plain findOne() row)
      procurement.ts                         — Supplier CRUD, PurchaseOrder create/query/findOne/receive
                                                 (receive() posts real RECEIVE stock movements and
                                                 recomputes ORDERED/PARTIAL/DELIVERED — no over-receiving
                                                 cap, matches the backend's "no hidden arithmetic" policy)
      sales.ts                                 — CustomerOrder CRUD + cancel/complete, give(Item|All)ToProduction,
                                                   shortage-preview + purchase-orders-from-shortage, Shipment
                                                   create/query/findOne/deliver/delete. Same DecimalString-vs-
                                                   plain-number split as bom.ts: shortage-preview's ShortageLine
                                                   fields are computed numbers, everything else is Prisma-row
                                                   DecimalString as usual — see the file's own header comment
      hr.ts                                     — grown from Task 46's minimal read-only Employee slice into
                                                    the full module: Employee CRUD + deactivate/reactivate
                                                    (never a hard delete), PayrollEntry manual-entry
                                                    create/query, payroll summary report (computed numbers,
                                                    not DecimalString — same split pattern as bom.ts/sales.ts)
      reports.ts                                 — 3 read-only aggregation endpoints (reorder suggestions,
                                                     warehouse valuation, monthly production rollup); no
                                                     create/update/delete anywhere in this module, and no
                                                     DecimalString-vs-number split to worry about since every
                                                     field is a computed number, never a raw Prisma row
      ai.ts                                        — askHelp/askAboutCustomerOrder/askFullAssistant,
                                                        confirmAiAction/cancelAiAction over the durable
                                                        PendingAiAction row, recognizeInvoice (inline base64,
                                                        not the presigned-upload flow), getAiSettings/
                                                        updateAiSettings (BYOK key never returned, only
                                                        hasCustomApiKey) — no DecimalString fields anywhere
                                                        in this module, see the file's header comment for
                                                        the full permission-per-endpoint breakdown
      notifications.ts                             — previewLowStockDigest()/sendLowStockDigestNow(); the
                                                        send-now result carries `sent: false` + a `reason`
                                                        (not an HTTP error) when the digest isn't configured
                                                        — see the file's header comment on why there's no
                                                        "next scheduled send" to build a UI for
      billing.ts                                     — listPlans() (ungated), getSubscription()/
                                                          updateSubscription() (company:billing-gated);
                                                          Plan.monthlyPriceEur is DecimalString as usual,
                                                          Plan.limits is a free-form JSON object typed loosely
      users.ts                                         — listUsers(), inviteUser() (returns tempPassword only
                                                            when a brand-new account was created, null when
                                                            attaching an existing global User), updateUserRole(),
                                                            deactivateUser() (a membership-removal POST, not a
                                                            DELETE on the global User), changeOwnPassword()
      roles.ts                                           — getPermissionsCatalogue(), listRoles(), createRole(),
                                                              updateRole(), deleteRole()
      audit.ts                                             — queryAuditEvents() (GETs `audit-events`, not
                                                                `audit` — matches the controller path exactly),
                                                                getEntityAuditHistory()
    hooks/
      use-catalog.ts             — TanStack Query hooks over api-client/catalog.ts; production-readiness
                                     pass added useImportProducts() (invalidates ['products'] on success,
                                     same as every other catalog mutation) and useExportProducts() (a plain
                                     one-shot mutation, not a cached query — triggers the browser's native
                                     save-file flow via an object-URL anchor click, no new dependency)
      use-settings.ts              — TanStack Query hooks over api-client/settings.ts
      use-inventory.ts             — TanStack Query hooks over api-client/inventory.ts
      use-bom.ts                     — TanStack Query hooks over api-client/bom.ts
      use-hr.ts                        — useEmployees() (read-only slice, see api-client/hr.ts)
      use-production.ts                  — TanStack Query hooks over api-client/production.ts; start()
                                             invalidates stock-levels/stock-history/finished-goods too,
                                             since it's a real stock-consuming mutation like BOM's produce()
      use-procurement.ts                   — TanStack Query hooks over api-client/procurement.ts; receive()
                                               invalidates stock-levels/stock-history too, same reasoning
      use-sales.ts                           — TanStack Query hooks over api-client/sales.ts; give(Item|All)ToProduction
                                                 invalidate production-orders too; createShipment/deleteShipment
                                                 invalidate finished-goods (status flips IN_STOCK<->SHIPPED)
      use-hr.ts                                — grown from Task 46's useEmployees into the full module's
                                                   hooks; useRecordPayrollEntry invalidates both payroll-entries
                                                   and payroll-summary (the summary report reads from the same
                                                   ledger, so a new entry makes both stale)
      use-reports.ts                             — three plain useQuery hooks, no mutations anywhere —
                                                     Reports has no create/update/delete endpoints
      use-ai.ts                                    — every ask-*/confirm/cancel/recognize call is a
                                                        useMutation (one-shot requests, not cached resources
                                                        with an identity); only ai/settings is a real
                                                        useQuery-backed resource
      use-notifications.ts                           — useLowStockDigestPreview() (a real useQuery — the
                                                          preview content changes as stock moves, so it's
                                                          refetched, not one-shot) + useSendLowStockDigestNow()
      use-billing.ts                                   — usePlans()/useSubscription() (useQuery) +
                                                            useUpdateSubscription() (invalidates the
                                                            subscription cache key on success)
      use-users.ts                                        — useUsers(), useInviteUser(), useUpdateUserRole(),
                                                               useDeactivateUser(), useChangeOwnPassword() —
                                                               mutations invalidate the `['company-users']` key
      use-roles.ts                                          — useRoles(), usePermissionsCatalogue() (1hr
                                                                 staleTime — the catalogue is a fixed constant),
                                                                 useCreateRole(), useUpdateRole(), useDeleteRole()
      use-audit.ts                                            — useAuditEvents(query), useEntityAuditHistory()
      use-speech.ts                                             — NOT a use-<module>.ts api-client wrapper
                                                                    (deliberate naming break, disclosed): wraps
                                                                    the browser's native SpeechRecognition/
                                                                    speechSynthesis globals, a browser-capability
                                                                    concern rather than a backend-data concern,
                                                                    same layering choice as auth/session-store.ts.
                                                                    Exports useSpeechRecognition(), useSpeechSynthesis(),
                                                                    and the pure speechLangForLocale() helper
                                                                    (uk→uk-UA, en→en-US, pl→pl-PL, de→de-DE)
    auth/
      cookie-names.ts            — shared cookie name constants
      server-cookies.ts           — set/clear the four httpOnly cookies (used by the three route handlers)
      session-store.ts             — Zustand: in-memory access token + identity
      actions.ts                    — login()/logout()/restoreSession(), calling our own /api/auth/* routes
  messages/uk.json, en.json, pl.json, de.json
  i18n.ts, middleware.ts, tailwind.config.ts, next.config.mjs
```

**Pattern to follow for every later module** (established in Task 43, keep using it): `lib/api-client/<module>.ts` (plain typed fetch functions, field shapes copied from the real DTOs) → `lib/hooks/use-<module>.ts` (TanStack Query wrapping those, owns cache keys/invalidation) → components/pages call only the hooks, never `apiClient` or the api-client functions directly.

## Local development

```bash
cd frontend
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_BASE_URL at a running backend
npm run dev
```

Requires the backend running locally per `backend/README.md`.

**Verification note:** unlike the backend (blocked by a 403 on `binaries.prisma.sh` and a corrupted `node_modules` mount — see `backend/README.md`), a real `npm install`, `tsc --noEmit`, `jest`, and `next build` all ran successfully against this codebase in a clean scratch directory, re-run after each task: 778 packages installed, 0 type errors, **80/80 tests passing** (19 suites), and a full production build completed (`✓ Compiled successfully`, 61 routes generated, including all three `app/api/auth/*` route handlers and the two new pages: `/notifications`, `/billing`).

**Re-verified after the Users/Roles/Audit admin module (production-readiness pass):** clean scratch reinstall (776 packages), `tsc --noEmit` 0 errors, `jest --ci` **92/92 tests passing (22 suites, up from 80/19)** — the three new suites are `lib/api-client/{users,roles,audit}.test.ts`. `next build` completed clean, 50/50 static pages generated including the three new `/admin`, `/admin/roles`, `/admin/audit` routes at 3.05-5.04 kB each. No new environment hiccups this pass (the `lucide-react`/incremental-install issue documented below did not recur, since this pass used a full clean reinstall from the start).

**Re-verified again after Excel import/export (production-readiness pass, second shipped item):** clean scratch reinstall (776 packages), `tsc --noEmit` 0 errors, `jest --ci` **98/98 tests passing (24 suites, up from 92/22)** — the two new suites are `lib/api-client/catalog.test.ts` (importProducts/exportProducts request shapes) and `lib/api-client/http.test.ts` (the first direct test of `postFile`/`getBlob` against a mocked `global.fetch`, confirming the real `FormData`/no-manual-Content-Type/Bearer-header/401-retry behavior, not just that the api-client function calls the right method name). `next build` completed clean, 50/50 static pages, `/catalog` grew from 3.18 kB to 3.69 kB (the two new buttons + dialog).

**Re-verified a third time after document/label printing (production-readiness pass, third shipped item):** clean scratch reinstall (776 packages). First `tsc` pass caught one real bug before it shipped: `PickListPrint`'s `unitsPlanned` prop was typed `number`, but `ProductionOrder.unitsPlanned` is a `DecimalString` (Decimal fields serialize as JSON strings, per this file's own convention above) — fixed by retyping the prop, not by force-casting. After that fix: `tsc --noEmit` 0 errors, `jest --ci` **102/102 tests passing (25 suites, up from 98/24)** — the new suite is `components/domain/catalog/product-labels-dialog.test.ts`, covering the pure `expandLabelCopies()` helper (copy-count expansion, multi-product flattening, empty-selection and zero-copies edge cases) without mounting the dialog. `next build` completed clean, 50/50 static pages; five routes grew with their new print buttons: `/catalog` 3.69→4.87 kB, `/production/[id]` →5.47 kB, `/bom/[id]/components` →4.72 kB, `/sales/[id]` →4.07 kB, `/sales/[id]/shortage` →8.81 kB.

**Re-verified a fourth time after the Product spreadsheet/grid view (production-readiness pass, fourth shipped item):** clean scratch reinstall (776 packages), `tsc --noEmit` 0 errors on the first pass this time, `jest --ci` **111/111 tests passing (26 suites, up from 102/25)** — the new suite is `components/domain/catalog/product-grid-columns.test.ts` (filter AND-combination and empty-filter-value handling, distinct-value computation, and column-config invariants — exactly one `special: 'qty'` column, no dropped `photoUrl`/`usedInAssemblies` keys, `unit` marked as the select-backed type). `next build` completed clean, 51/51 static pages (up from 50), the new `/catalog/grid` route at 6.65 kB. Note: several unrelated routes' reported sizes shifted up or down a few kB in this build compared to the prior verification pass (e.g. `/hr/new` 7.58→4.24 kB, `/ai/order-qa` 4.99→2.73 kB) — this is Next.js's shared-chunk bundling re-balancing as new modules were added to the dependency graph, not a sign of a regression; every route still built successfully and no test touching those pages changed behavior. One environment-specific hiccup this run, not a code issue: an incremental `npm install` (on top of an existing `node_modules` from a prior task's verification) left `lucide-react` with its `.js` files but no `.d.ts` typings, producing ~30 `TS7016` errors across every file that imports an icon — a full `rm -rf node_modules && npm install` (not incremental) resolved it cleanly, npm's dependency-tree diffing apparently doesn't always reconcile a package's file set correctly on this sandbox's mount. Worth doing a clean reinstall rather than an incremental one if a future verification pass shows type errors concentrated in a single third-party package across many unrelated files — that pattern points at a corrupted `node_modules` entry, not a real code bug. One other environment-only wrinkle seen on some runs: `next build` occasionally prints a lockfile-patch warning and a `getaddrinfo EAI_AGAIN registry.npmjs.org` network error before compiling — this sandbox has no route to the real npm registry, Next tried to reach it anyway for an SWC-dependency check, failed, and continued the build normally regardless. The frontend has no Prisma/native-binary dependency, so it doesn't hit the same sandbox blockers as the backend. Lessons worth remembering for future test files: (1) any test that imports from `next/server` (route handlers, middleware helpers) needs a per-file `@jest-environment node` override, since `NextResponse` needs Fetch API globals jsdom doesn't provide; (2) `jest.config.js`'s ts-jest transform overrides `jsx` to `"react-jsx"` — `tsconfig.json` sets `jsx: "preserve"` for Next's own bundler, and without the override any test that imports a `.tsx` file (even just for a non-component helper export, as `product-form.test.ts` does for `productToFormValues`) fails with `Unexpected token '<'`; (3) a variable narrowed by an early-return guard (`if (!fg) return <Loading/>`) does *not* stay narrowed inside a function declared later in the same component body; (4) a `/** ... */` doc comment containing the literal two-character sequence `*/` anywhere in its prose (not just as the closer) silently truncates early (caught in `lib/api-client/ai.ts` during Task 51's own verification); (5) an incremental `npm install` can leave a package's typings missing even though the package "installed successfully" with no error — a corrupted-`node_modules` symptom, not a real regression, per this task's `lucide-react` finding above. Still not exercised: any of these API calls against a *real* backend (no live backend in this sandbox); AI's `askFullAssistant` tool-calling loop against a real Gemini key; billing's plan-switch against a real Stripe integration (there isn't one — Phase 0 stub, by design). All flagged as manual pre-deploy smoke-test items, not gaps in this verification pass.

**Re-verified a fifth time after AI voice mode (production-readiness pass, fifth and final shipped priority item):** clean scratch reinstall. One environment-only hiccup this pass, distinct from the `lucide-react` one above: the `@next/swc-linux-arm64-gnu` native binary was truncated (`file` reported "missing section headers") from a prior incremental install, causing `next build` to crash immediately with `Bus error (core dumped)` — `tsc --noEmit` and `jest --ci` were both unaffected (they don't load the SWC native binary the same way), so this was caught only at the build step. Fixed the same way as the `lucide-react` case: `rm -rf node_modules && npm install` (a full reinstall, not incremental) restored a valid binary. After that: `tsc --noEmit` 0 errors, `jest --ci` **113/113 tests passing (27 suites, up from 111/26)** — the new suite is `lib/hooks/use-speech.test.ts`, covering the pure `speechLangForLocale()`/`SPEECH_LANG_BY_LOCALE` mapping (the `SpeechRecognition`/`speechSynthesis` wrapper hooks themselves are browser-only and not exercised in jsdom, same "extract and test the pure logic" pattern as `expandLabelCopies` and `filterProductsByFieldValues` above). `next build` completed clean, 51/51 static pages, `/ai/full-assistant` grew from 4.62 kB to 6.01 kB (mic button + TTS toggle + the two new icons). Disclosed scope boundary: no legacy `.gs`/`.html` source has any speech/voice feature at all (confirmed by grepping `AI_FullAssistant.gs` and its HTML for speech/voice/audio/microphone/мовлення/голос — zero matches) — this is new capability built on top of the existing `askFullAssistant` contract, not a ported feature, consistent with how the owner scoped it as the fourth of four explicitly-prioritized items rather than a parity gap.

## What's next

**The Phase 2 §26 frontend roadmap is now fully implemented — Tasks 41 through 52, all 12 backend modules have a working frontend.** What's deliberately NOT built, disclosed rather than silently absent, going into a first real deploy:

- **Real Stripe checkout.** `billing.service.ts`'s own header comment: `updatePlan` records a plan change immediately with no payment collection and no Stripe webhook. The `/billing` page's "switch to this plan" button is honest about what it does (a stub), but a real launch needs actual payment collection before this is safe to expose to real customers.
- **Real digest scheduling.** No BullMQ/Redis queue exists anywhere in this codebase (Phase 2 §9, never built through any of the 12 backend modules) — `/notifications`'s "send now" is genuinely the only send path, not a manual override of something that also runs automatically. A real daily 8am digest needs a new architecture decision (most likely a narrow BYPASSRLS role for a background-job process, mirroring `auth_service`'s own ADR-0009 pattern, since enumerating every company's `CompanySettings` is a cross-tenant read no current DB role can do) — flagged for the project owner, not decided unilaterally.
- **Tenant branding in the shell chrome** (topbar logo override) — still not wired in, same gap noted since Task 43; the underlying pre-login public-branding-URL gap it depends on was never resolved either (see "Known gap: pre-login branding images" below).
- **A dedicated Polish/German translation pass** — `messages/pl.json`/`de.json` have been English-copy placeholders since Task 41; every module's real translations only ever went into `uk.json`/`en.json`.
- **Live-backend smoke testing** — every module's `tsc`/`jest`/`next build` verification has been real, but no page in this app has ever actually talked to a running NestJS backend inside this sandbox (no backend process running here). The `AskFullAssistant` tool-calling loop specifically has never run against a real Gemini API key.
- **The five-module "raw id, no name" simplification** (tracked in detail below) — a real backend batch id-resolution endpoint would remove it from Inventory/BOM/Production/Procurement/Sales in one pass, rather than five separate per-file workarounds.

**AI turned out to need no new picker or `DataTable` reuse at all** — the only cross-module component reused was `CustomerOrderPicker` (Sales, Task 48) for the order-Q&A page. Its own new component, `PendingConfirmationCard`, is a one-off (only `askFullAssistant` produces a `pendingConfirmation`), not a sibling of the five typeahead pickers. Notifications + Billing (Task 52) added no new picker either — `/notifications` reuses `useCompanySettings` (Task 43) to check digest readiness, `/billing` reuses `toNumber()` (the Decimal-string helper) for `Plan.monthlyPriceEur`, and neither module has anything resembling an entity-search field to pick from.

**AI adds zero new instances of the "raw id, no name" simplification tracked below**, same as Reports — `askAboutCustomerOrder` resolves assembly names server-side before building its answer, `recognizeInvoice`'s response already carries `matchedName`/`article`, not a bare id, and the full assistant's tool results are plain text/JSON blobs the model narrates, never a raw UUID rendered in a table cell.

**Reports turned out to have zero instances of the "raw id, no name" simplification** — worth noting since every other module since Inventory has added at least one. `reports.service.ts` already resolves `article`/`name`/`assemblyName`/`category` itself before returning (confirmed by reading all three methods), so none of the three report pages needed the workaround documented below.

**Known simplification, present in five modules — worth a real backend addition rather than a sixth workaround if it recurs again**: list/detail views show raw `productId`/`subAssemblyId`/`assemblyId`/`supplierId`/`finishedGoodId` rather than a name, because the relevant GET endpoints don't join to the referenced entity and there's no batch id-resolution endpoint. Sales hits this twice (`CustomerOrderItem.assemblyId`, `ShipmentItem.finishedGoodId`); Procurement sidesteps it for products via order-time `articleSnapshot`/`productNameSnapshot` capture (deliberate, not a workaround); HR doesn't add a new instance. Documented per-file rather than silently degrading (N+1 lookups per row) or making an unrequested backend change.

**A real, deliberate scope boundary carried over from the backend, worth remembering if a shortage-preview bug ever gets reported**: the recursive shortage engine (`customer-order-shortage.service.ts`) reads `Assembly.defaultSupplierId` to decide whether to recurse into a sub-assembly's own components or stop and treat it as a buy-line — the *opposite* default from BOM's cost/availability engine (`assemblies.service.ts`), which always flattens fully regardless of that field. Both modules read the same schema field for two intentionally different purposes; the shortage-preview page and BOM's cost/availability page can legitimately disagree about a sub-assembly's status without either being wrong. Flagged here (and in `lib/api-client/sales.ts`'s header comment) since it's the kind of cross-module inconsistency that looks like a bug at a glance.

**Known gap, disclosed rather than silently worked around**: `messages/pl.json` and `messages/de.json` are English-copy placeholders, same as they were left after Tasks 43–49 (only `uk.json`, the default, and `en.json` have real translated text). The new `reports` namespace follows the same existing convention for consistency — not a new gap introduced here, but worth a dedicated translation pass across all modules before a Polish/German-market launch.

**A real, deliberate scope boundary carried over from the backend, not a frontend shortcut**: `AssemblyComponent.warehouseId` (the "expected" warehouse on a BOM line) is informational only — `produce()` always resolves its actual consumption warehouse from `ProduceAssemblyInput.warehouseId` or the company default, never from the BOM line (confirmed in `assemblies.service.ts`'s own header comment). The BOM editor still lets you set a per-line warehouse (matches the DTO), but the availability/produce page's warehouse selector is a separate, independent field — this is backend behavior faithfully mirrored, not a frontend bug if the two ever look inconsistent.
