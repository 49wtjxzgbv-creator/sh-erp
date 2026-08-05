# SH ERP v1 — Complete System Documentation

Phase 1 deliverable. This is a full, file-by-file mirror of what exists today in the Google Apps Script project (folder "SHSklad 70"): every `.gs` file (30 files, 7,602 lines) and every `.html` file (21 files, 7,023 lines, of which the single `JavaScript.html` client accounts for 4,661 and `Style.html` for another 603) have been read in full. Nothing here is a redesign proposal — it documents current behavior only, including quirks, workarounds, and dead ends, so later phases can be checked against it.

---

## 1. Architecture overview

The whole system is one Apps Script "container-bound-style" web app (not actually bound to a sheet — it creates/finds its own spreadsheet by name, see §1.3):

- **Server**: `.gs` files, one per business domain. Every function callable from the browser must be added to `API_WHITELIST_` in `Code.gs` — that object is the entire server API surface (137 entries, verified by parsing the object literal directly).
- **Client**: a single-page app. `index.html` is the shell (header, sidebar nav, modals) and pulls in every other `.html` file via `<?!= include('name'); ?>`, plus `Style.html` (603 lines of CSS, wrapped in `<style>`) and `JavaScript.html` (4,661 lines of JS, wrapped in `<script>`) — Apps Script only allows `.gs`/`.html` files, so CSS/JS live inside HTML wrappers.
- **Transport**: NOT `google.script.run`. The client calls a normal `fetch(POST)` against the deployed web app URL (`doPost` in `Code.gs`), sending `{fn, args}` as JSON and getting `{success, data|error}` back. This was a deliberate move away from `google.script.run` because its hidden-iframe response channel was found to silently drop responses on some browsers/networks.
- **Database**: a Google Sheet named `SHSklad_DB`, containing 27 tabs (one per entity), created and migrated automatically by `Setup.gs`.
- **Files**: Google Drive, several auto-created folders (see §8).
- **Auth**: custom, not Google identity. Web app is deployed with `access: ANYONE_ANONYMOUS` — anyone can load the page, but every server function checks a session token.

### 1.1 Request lifecycle

`doGet(e)` (Code.gs) runs `ensureDatabase_()` (schema check/migration, skipped if already at current version — see §1.4), then renders `index.html` as a template, injecting the real deployed `/exec` URL as `apiUrl` (needed because the page actually renders inside a `script.googleusercontent.com` iframe, so `window.location.href` isn't usable).

Every subsequent client action calls the JS helper `call(fnName, ...args)` (JavaScript.html:94), which POSTs to that URL. `doPost` looks up `fnName` in `API_WHITELIST_`, calls it with the given args, and returns its result as JSON. No function outside that whitelist is reachable from the client, regardless of what's defined in the `.gs` files.

### 1.2 Auth & sessions

- `Auth.gs`: `login(loginName, password)` looks up the `Users` sheet, compares `hashPassword_()` (SHA-256, **unsalted**, hex-encoded) against the stored hash, and on success creates a session via `createSession_()`: a random UUID token stored in `CacheService.getScriptCache()` for `SESSION_TTL_SEC` (8 hours), value = JSON-serialized `{id, login, role, fullName}`.
- Every protected server function starts with `requireAuth_(token)` (throws if no session) or `requireRole_(token, ['admin', ...])` (throws if role not in the allowed list).
- `changeOwnPassword` lets any logged-in user change their own password (separate from `Users.gs`, which is admin-only management of *other* users).
- There is no refresh-token concept — sessions just expire after 8h and the user re-logs in. `checkSession` is called on page load (token cached client-side in `sessionStorage`) to restore state without a fresh login.
- Three roles, hardcoded in multiple places (`Users.gs` validates against `['admin','storekeeper','viewer']` on user creation): **admin**, **storekeeper** (комірник), **viewer** (перегляд). See §9 for the full, code-verified permission matrix — it differs in places from what `README.md` documents (README has drifted from the code).

### 1.3 Database bootstrap (`getDb_`, Code.gs)

`getDb_()` tries `SpreadsheetApp.getActiveSpreadsheet()` first (works only if bound to a sheet, which this deployment isn't), then a `DB_SPREADSHEET_ID` Script Property, then falls back to creating a brand-new spreadsheet called `SHSklad_DB` and persisting its ID in Script Properties. So the "database" is entirely addressed via Apps Script Script Properties, not a fixed ID.

### 1.4 Schema versioning & migration (`Setup.gs`)

- `SCHEMA_VERSION_` is currently `'22'` — i.e., the schema has been revised at least 22 times over the project's life.
- `ensureDatabase_()` compares the stored `SCHEMA_VERSION` script property to `SCHEMA_VERSION_`; if they match, it returns immediately (skips all sheet/column checks — this is a deliberate performance optimization so that every page load doesn't re-scan 27 sheets).
- If out of date: creates any missing sheet (`ensureSheet_`, sets header row + freezes it), then runs a series of `safeStep_()`-wrapped migrations, each independently try/caught so one failure doesn't block the rest:
  - `ensureColumnsExist_(sheet, requiredHeaders)` appends any missing column at the end of a sheet, never touching existing data/columns — this is the sole mechanism for adding fields to a live installation without wiping it.
  - `migrateProductsSchema_` — historical: renames old `PurchasePrice`/`GermanPriceEUR` single-price columns into the current two-supplier, VAT-split price model (`LocalPriceExclVat/InclVat`, `GermanPriceExclVat/InclVat`).
  - `seedUsersIfEmpty_` — creates the 5 starter accounts (admin/sklad/view1/view2/view3) only if `Users` is empty.
  - `seedDefaultWarehouseIfEmpty_`, `seedDefaultQCChecklistIfEmpty_`, `seedDefaultStagesIfEmpty_`, `seedUnitsIfEmpty_`, `seedVatRateIfEmpty_` — seed sensible defaults on first run.
- `setupDatabase()` — manual entry point (run from the Apps Script editor), forces a full re-check by deleting the stored `SCHEMA_VERSION` property first.
- `repairAssemblyCostColumns()` — a one-off manual repair function, kept in the codebase as a permanent fix tool: Google Sheets sometimes silently reformats a numeric cell as Date/Time, and reading a "zero" cell in that state returns `31.12.1899` instead of `0` — naive `Number(cell)` then yields a huge negative millisecond value. This actually happened in production (extra-cost columns on Assemblies showed nonsensical multi-trillion-euro negative costs) and this function was the fix. `numOrZero_()` (Assemblies.gs) is the permanent defensive guard against the same failure mode going forward, and `saveAssembly` now explicitly force-sets `.setNumberFormat('0.00')` on those columns every time they're written.

---

## 2. Full data dictionary (27 sheets)

All headers below are exact, taken verbatim from `Setup.gs`. Types/relations are inferred from how each column is read/written across the codebase (Apps Script Sheets have no real types — everything is a cell value).

| Sheet | Columns | Notes |
|---|---|---|
| **Users** | ID, Login, PasswordHash, Role, FullName, Active, CreatedAt | Role ∈ {admin, storekeeper, viewer}. PasswordHash = unsalted SHA-256 hex. |
| **Products** | ID, Article, Code, Name, Description, Category, ProductGroup, Family, Type, Kind, ProductLine, Barcode, Unit, UnitsPerPackage, Cell, Qty, MinQty, LocalPriceExclVat, LocalPriceInclVat, GermanPriceExclVat, GermanPriceInclVat, SellPriceEUR, WeightPerUnitKg, WarrantyMonths, Status, Manufacturer, ManufacturerCode, CountryOfOrigin, PriceListRef, Note, PhotoUrl, QrUrl, CreatedAt, UpdatedAt, DefaultSupplierId | Article is the effective unique business key (checked case-insensitively on create/import). `Qty` is the single source of truth for stock level — warehouse breakdown (below) is a parallel, non-authoritative allocation view. `DefaultSupplierId` → Suppliers.ID, used to auto-route shortage requests. |
| **History** | Timestamp, User, Action, Article, Name, Qty, Comment | Append-only audit log. No delete function exists anywhere in the codebase for this sheet — enforced by omission, not by a DB constraint. |
| **Units** | Name | Simple flat list (шт, уп, кг, м, рулон, комплект by default). |
| **Settings** | Key, Value | Generic key/value store. Known keys: `VatRatePercent`, `DashboardWidgets` (JSON array), `DailyDigestEmail`, `BrandSiteLogoUrl`, `BrandPrintLogoUrl`, `BrandFaviconUrl`. |
| **Assemblies** | ID, Name, Article, Note, PhotoUrl, CreatedAt, UpdatedAt, LaborCostPerUnit, PackagingCostPerUnit, DeliveryCostPerUnit, OtherCostPerUnit, DrawingFileUrl, DrawingFileName, DrawingMimeType, DrawingOriginalUrl, DefaultSupplierId | The BOM header record ("виріб"). `DefaultSupplierId` set = this assembly is purchased finished from a supplier rather than manufactured in-house (changes recursive shortage logic, §6.3). |
| **AssemblyComponents** | ID, AssemblyID, ProductID, Qty, WarehouseID, ComponentType, SubAssemblyID | One row per BOM line. `ComponentType` ∈ {product, assembly}. If `assembly`, `SubAssemblyID` points to another Assemblies row (recursive BOM, cycle-protected in code, not in schema) and `ProductID`/`WarehouseID` are blank. `Qty` = per-one-unit-of-parent quantity. |
| **ProductionOrders** | ID, AssemblyID, AssemblyName, UnitsPlanned, Status, User, CreatedAt, CompletedAt, Comment, PickListJson, TotalLocalCostEur, TotalGermanCostEur, CurrentStageIndex, StageHistoryJson, BOMVersionNumber, LaborCostEur, PackagingCostEur, DeliveryCostEur, OtherCostEur, FullCostEur, AssignedWorkersJson | Status ∈ {planned, in_progress, completed}. `PickListJson`, `StageHistoryJson`, `AssignedWorkersJson` are all JSON blobs in a single cell — each is really a child table (pick-list line items; stage-change log with user+timestamp; worker→percent split for piecework pay) hidden inside a string column. `BOMVersionNumber` pins this order to a specific AssemblyVersions snapshot (§2 below), so a later BOM edit never retroactively changes an in-flight order's material list or cost. |
| **ProductionStages** | ID, Name, SortOrder | Admin-configurable ordered list (defaults: Розкрій → Обробка → Зварювання/збірка → Фарбування → Пакування). Does not affect reservation/stock logic — purely a visible progress tracker. |
| **CustomerOrders** | ID, OrderNumber, ClientName, ContactPerson, Deadline, Priority, Status, DocumentFileUrl, DocumentFileName, Comment, CreatedBy, CreatedAt | Status ∈ {new, in_production, completed, cancelled}. Priority ∈ {low, normal, high, urgent} (free text, not enforced server-side). |
| **CustomerOrderItems** | ID, CustomerOrderID, AssemblyID, AssemblyName, Qty, ProductionOrderID | One row per assembly line in a customer order. `ProductionOrderID` is set once that specific line has been "given to production" — this is what enables per-line ("poetapne") production rather than all-or-nothing. |
| **FinishedGoods** | ID, SerialNumber, AssemblyID, AssemblyName, ProductionOrderID, ManufactureDate, Status, CustomerOrderID, Comment, UnitCostLocalEur, UnitCostGermanEur, ConsumedInProductionOrderID | One row per **physical unit** produced (not per order) — created in a loop, one append per unit, when a production order starts. Serial format `SN-000001`, generated via a `LockService`-guarded counter in Script Properties (the only place besides Telegram polling that uses an explicit lock). Status ∈ {in_stock, shipped, consumed, rework, defective(implied)}. `ConsumedInProductionOrderID` set when this unit was used as a sub-assembly component of a higher-level product (full FIFO traceability). |
| **AssemblyVersions** | ID, AssemblyID, VersionNumber, ComponentsJson, CreatedAt, CreatedBy | Immutable BOM snapshot, one new row appended every time `saveAssembly` is called (never updated/overwritten). `ComponentsJson` is the full component list at that point in time. This is what `ProductionOrders.BOMVersionNumber` locks onto. |
| **InventorySessions** | ID, Name, Status, StartedBy, StartedAt, CompletedAt, Comment | Status ∈ {in_progress, completed}. |
| **InventoryItems** | ID, InventorySessionID, ProductID, Article, ProductName, ExpectedQty, ActualQty, Counted | One row per product, snapshotted at session start (`ExpectedQty` = `Products.Qty` at that instant). `Counted` boolean flips to true once someone records `ActualQty`. |
| **QCChecklist** | ID, Name, SortOrder | Admin-configurable checklist item names (defaults: 5 generic QC checks). |
| **QCChecks** | ID, FinishedGoodID, SerialNumber, ChecklistJson, PhotoUrl, Result, Inspector, CheckedAt, Comment | One row per QC inspection event. `ChecklistJson` = array of `{item, passed}`. Result ∈ {accepted, rework}. |
| **Shipments** | ID, Carrier, WaybillNumber, PackageCount, Weight, Dimensions, PhotoUrl, ShipDate, DeliveryDate, Status, CustomerOrderID, Comment, CreatedBy, CreatedAt | Status ∈ {shipped, delivered}. |
| **ShipmentItems** | ID, ShipmentID, FinishedGoodID, SerialNumber | Join table — one row per finished-good unit in a shipment. |
| **Employees** | ID, FullName, Position, Phone, PhotoUrl, HireDate, Status, Notes | Status ∈ {active, inactive}. Deletion is always a soft-deactivate (`Status='inactive'`), never a row delete — preserves payroll history integrity. |
| **PayrollEntries** | ID, EmployeeID, Type, ProductionOrderID, AssemblyName, UnitsProduced, Amount, EntryDate, Comment, CreatedBy, CreatedAt | Type ∈ {piecework, advance, bonus, penalty}. Advances and penalties are stored as **negative** amounts, bonuses/piecework as positive — so `SUM(Amount)` per employee is directly "net owed." Piecework rows are created automatically by `startProductionOrder`; the other three types are manual, admin-only entries. |
| **Suppliers** | ID, Name, ContactPerson, Phone, Email, Notes, CreatedAt | Standalone entity (added later in the project's life per the project-context notes) — referenced by `Products.DefaultSupplierId` and `Assemblies.DefaultSupplierId`. |
| **TelegramUsers** | ChatID, UserID, Login, Role, FullName, LinkedAt | Maps a Telegram chat ID to a Users row. Role/FullName are a cache, kept in sync opportunistically by `tgFindUser_` when they drift from the live Users row (and access is revoked immediately if the underlying user is deactivated). |
| **Warehouses** | ID, Name, IsDefault, CreatedAt | Exactly one row must have `IsDefault=true` at all times (enforced by `deleteWarehouse` refusing to delete the default, and requiring ≥1 warehouse to always remain). |
| **WarehouseStock** | ID, ProductID, WarehouseID, Qty | Sparse allocation table: only holds rows for **non-default** warehouse assignments. The default warehouse's quantity for any product is always computed as `Products.Qty − Σ(non-default allocations)`, never stored directly — see §6.6. |
| **PurchaseOrders** | ID, Supplier, SupplierId, Status, OrderDate, ExpectedDeliveryDate, InvoiceFileUrl, InvoiceFileName, Comment, CreatedBy, CreatedAt, SourceCustomerOrderID | Status ∈ {ordered, partial, delivered}. `Supplier` (free text, historical) and `SupplierId` (FK to Suppliers, newer) coexist — a PO can have a supplier name with no linked Suppliers row if created before/without a match. `SourceCustomerOrderID` set when auto-generated from a customer order's shortage analysis. |
| **PurchaseOrderItems** | ID, PurchaseOrderID, Article, ProductName, QtyOrdered, QtyReceived, ExpectedPrice, ActualPrice | Line items keyed by `Article` (text), not `ProductID` — this lets a PO reference an article that doesn't exist in Products yet (e.g., a brand-new item first seen on an incoming invoice). |

---

## 3. Module-by-module reference (all 30 `.gs` files)

Grouped by domain. Every function name below is exact; `_` suffix = internal helper, not in `API_WHITELIST_`, unreachable from the client.

### 3.1 Core / infrastructure
- **Code.gs** — `doGet`, `doPost`, `include`, `getDb_`, `getPhotosFolder_`, `ok_`/`fail_` (uniform response envelope), `newId_` (UUID), `nowStr_` (Europe/Kyiv formatted timestamp), and the full `API_WHITELIST_` map (137 entries).
- **Setup.gs** — schema creation/migration, described fully in §1.4.
- **Auth.gs** — login/session/role-check primitives, described in §1.2. Also `indexMap_(headers)` — a tiny but critical helper used in nearly every other file: turns a header row into a `{ColumnName: index}` map so the rest of the code never hardcodes column positions (this is *why* `ensureColumnsExist_` can safely append new columns without breaking existing code — every read goes through this lookup).
- **Users.gs** — admin-only CRUD for other users' accounts (`listUsers`, `createUser`, `updateUser`, `deleteUser`). Validates role is one of the 3 known values; blocks self-deletion.

### 3.2 Warehouse / inventory core
- **Products.gs** — product CRUD, search/filter, and the role-based price-stripping pattern (`stripPriceIfNeeded_`) used consistently everywhere prices could leak to non-admins. `getProductUsageMap_` computes, for each product, which assemblies directly reference it (one level only, not recursive) — powers the "used in assemblies" column. Create/update restricted to admin+storekeeper; delete (single or bulk) restricted to admin.
- **Warehouse.gs** — `receiveStock`, `bulkReceiveStock` (Excel/manual batch receive by article), `issueStock`, `writeOffDefect` (issue variant that mandates a reason comment, logged distinctly from normal issue), `adjustStock` (set-to-exact-value, used by inventory reconciliation), `moveStock` (cell relocation, doesn't change quantity). All funnel through `applyStockChange_`, which is the single place quantity actually changes and refuses to let stock go negative.
- **History.gs** — append-only logger (`logHistory_`, called from ~20 other functions across the codebase) plus two read endpoints. No update/delete capability exists.
- **Drive.gs** — photo/drawing upload-delete for products and assemblies. All uploaded files get `ANYONE_WITH_LINK / VIEW` sharing and a `drive.google.com/thumbnail?id=...` URL (this is what makes them directly embeddable as `<img>` — including for PDF drawings, which Drive auto-thumbnails).
- **Labels.gs** — despite the filename pattern, this **replaced** QR-code printing entirely. In-browser QR camera scanning was found unreliable (an architectural limitation of the Apps Script iframe + browser camera combination) and was dropped in favor of printing the plain article text and reading it directly — `README.md` still documents the old QR-based workflow and is stale on this point.
- **ImportExport.gs** — the "smart" Excel import: `FIELD_SYNONYMS` is a hand-maintained dictionary mapping many human header variants (Ukrainian/Russian/English, with/without diacritics, abbreviated) to internal field names; `buildHeaderMap_` picks the *longest* matching synonym per header to avoid ambiguity (e.g. "ціна наша з пдв" must not match the shorter "ціна наша" synonym first). Import is admin-only; existing articles are updated, new ones created; a photo can be embedded (client extracts it and sends as `_photoBase64`, distinguished from real file columns by the leading underscore, a fix for an earlier bug where the raw mime-type string leaked into the photo field). Export blanks price columns for non-admins.
- **Warehouses.gs** — virtual multi-warehouse support layered *on top of* the single authoritative `Products.Qty` (explicitly documented in the file's own header comment as a deliberate non-breaking addition). `WarehouseStock` only stores non-default-warehouse allocations; the default warehouse is always "whatever's left."

### 3.3 Assemblies / BOM / production
- **Assemblies.gs** (712 lines, one of the largest files) — full BOM CRUD, recursive cost calculation (`calcAssemblyCost_`, cycle-protected via a `visitedAssemblyIds` set passed down the recursion), availability checking, and the simpler "Дати в роботу" reservation-free direct-produce path (`produceAssembly`, distinct from the full `ProductionOrders.gs` reserve→start flow — see §6.1 for how these two relate). Every `saveAssembly` call also writes an immutable version snapshot (`saveAssemblyVersionSnapshot_`) to `AssemblyVersions`. `numOrZero_` guards against the Date-formatting corruption described in §1.4.
- **ProductionOrders.gs** (509 lines) — the primary production workflow: `createProductionOrder` (reserve, doesn't touch physical stock), `startProductionOrder` (physically list-consume components using the *locked* BOM version, generate FinishedGoods rows with serials, compute and permanently freeze cost, split piecework pay among assigned workers), `cancelProductionOrder` (planned-only), `getReservedQtyMap_`/`getReservedFinishedGoodsMap_` (on-the-fly reservation totals — **not** stored anywhere, recomputed from all `planned` orders every time; a documented past performance issue was fixed by batching the AssemblyComponents read once instead of per-order).
- **ProductionStages.gs** — configurable stage list + `advanceProductionStage` (records each transition with user+timestamp into `StageHistoryJson`; auto-completes the order when the last configured stage is reached).
- **FinishedGoods.gs** — per-unit serial tracking. `consumeFinishedGoods_` implements FIFO consumption (oldest `manufactureDate` first) when a finished sub-assembly is used as a component of a parent assembly. `generateSerialNumber_` is the one place using an explicit `LockService` lock (10s wait) to avoid duplicate serials under concurrent production-order starts.
- **QualityControl.gs** — checklist-based inspection tied to a specific FinishedGoods unit; result flips that unit's status between `in_stock` (accepted) and `rework`.
- **InventorySessions.gs** — snapshot → count → reconcile workflow; `completeInventorySession` calls `adjustStock` (the same function the UI's manual "coригувати" button uses) for every counted item with a non-zero difference, so reconciliation goes through the exact same audited code path as a manual correction.

### 3.4 Sales / procurement
- **CustomerOrders.gs** (568 lines) — order header + line items; the recursive shortage-collection engine (`collectShortageGroups_`) is the most algorithmically involved function in the codebase: it walks nested assemblies, and — critically — uses **shared, mutable pools across the whole order** rather than per-line-item independent checks, specifically because an earlier per-item-only version undercounted shortages when two products in the same order shared a common component. By explicit, documented product decision, it does **not** subtract current stock automatically; it returns the full gross requirement and lets the human compare it against the separately-shown current stock and adjust by hand (§10.1 — this is a preserved business rule, not a gap).
- **PurchaseOrders.gs** — multi-line POs with optional attached invoice file; `receiveFromPurchaseOrder` lets receiving happen directly from the PO screen (calls the same `bulkReceiveStock` the Products page uses), tracks partial delivery, and records `ActualPrice` separately from `ExpectedPrice` per line so realized cost can differ from what was quoted.
- **Suppliers.gs** — simple CRUD, no delete-protection against in-use references (a PO or Product/Assembly can point to a since-deleted supplier ID; UI falls back to "(постачальника видалено)").
- **Shipments.gs** — groups FinishedGoods units (by serial number) into a shipment record; marks each consumed unit's status `shipped`.

### 3.5 People / money
- **Employees.gs** — admin-only; soft-delete only (deactivate, never row-delete, to preserve payroll linkage).
- **Payroll.gs** — automatic piecework entries created from `startProductionOrder` (labor cost split by assigned-worker percentages, normalized to sum to 100 if the input percentages don't); manual advance/bonus/penalty entries (sign convention: advances & penalties negative, bonuses positive); `getPayrollSummaryReport` additionally cross-references QC results to surface a defect count per employee (via their production order IDs).

### 3.6 Reporting / settings / branding
- **Reports.gs** — reorder suggestions (target = 2× min stock, using *available* = qty minus reservations), 5-price warehouse valuation with category breakdown (admin-only), monthly production rollup.
- **Settings.gs** — VAT rate, `getBootstrapData` (single combined call bundling units + filter options + stats + dashboard widget config, explicitly to cut down on the ~1-3s cold-start cost of separate Apps Script invocations), configurable dashboard widget visibility, low-stock/stats aggregation (used by both the dashboard and the daily digest), backup creation/listing (full spreadsheet file copy via Drive).
- **Branding.gs** — admin-uploadable site logo / print logo / favicon, stored as Settings key/value rows pointing at Drive URLs. `getBrandingAssets` is deliberately **not** auth-gated (called before login, to brand the login screen itself).
- **Automation.gs** — daily 8am time-trigger (`dailyLowStockDigest_`) emailing a low-stock + 14-day-forecast summary, and best-effort mirroring the same text to Telegram admins.

### 3.7 AI
- **Gemini.gs** — low-level Gemini HTTP client (`callGemini_`/`fetchGeminiJson_`) shared by both AI features; uses the `gemini-flash-latest` **alias** deliberately (not a pinned model version) because pinned versions have gone stale/unavailable multiple times in this project's history; has one automatic retry with Google's suggested delay on 429/quota errors, capped at 55s to stay within Apps Script's execution limits. Two features live here: `recognizeInvoiceWithAI` (photo/scan → structured line items, fuzzy-matched against existing Products by name), and `askHelpAssistant`/`askAboutCustomerOrder` — a simple instructions-only chatbot (`HELP_MANUAL_TEXT_`, a hardcoded manual) that deliberately has **no access to live data**, so it cannot hallucinate wrong numbers about real stock/orders — versus `askAboutCustomerOrder` which *does* get real data for one specific order, scoped narrowly.
- **AI_FullAssistant.gs** — the full function-calling assistant (`askFullAssistant`), with its own tool catalogue (`AI_TOOLS_`, 16 tools) separate from the simple Довідник. Tools are read-only wrappers around existing whitelisted functions **except** `adjustProductStock`, which is marked critical (`AI_CRITICAL_TOOLS_`) and never executes inline — it always returns a `needs_confirmation` status, and the actual mutation only happens via a separate, explicit `confirmAiAction` call triggered by the user clicking a confirm button in the UI. Also includes `forecastPurchaseNeeds_` (60-day consumption-rate projection from History) and `findProductionDelays_` (flags orders stuck ≥3 days planned-not-started or stage-not-advanced).

### 3.8 Telegram
- **Telegram.gs** (698 lines, largest single file after JavaScript.html) — polling-based bot (see §7 for why, and the full command/report catalogue), reusing the exact same `login()` function as the web app so credentials are never duplicated, and the exact same list/get functions (via a freshly minted 8h session token) to generate Excel/PDF reports so Telegram output can never drift from what the web UI would show for the same role.

---

## 4. Client architecture (`JavaScript.html`, 4,661 lines)

This is a single hand-written SPA (no framework), organized as one big script with ~150 top-level functions. Structurally:

- **Transport**: `call(fnName, ...args)` (line 94) — the fetch/POST wrapper described in §1.1. Every other function in the file goes through it; there is no other way the client talks to the server.
- **Global state**: a `STATE` object (token, current user, cached lists) plus several page-specific `STATE_*` globals (e.g. `STATE_PO_ITEMS`, `STATE_BRANDING`).
- **Routing**: `navigateTo(view)` toggles `.hidden` on `<section id="view-*">` blocks — no URL router beyond a `#hash`.
- **Rendering**: manual DOM string-building (`innerHTML +=` patterns) per view — one `load*`/`render*` function pair per page (products, assemblies, production, customer orders, purchases, warehouses, reports, finished goods, inventory, QC, shipments, employees, payroll, settings, the raw spreadsheet-style product grid).
- **Danger confirmation**: `confirmDangerous_()` — deletions never use a plain `confirm()`; the user must read a shown random 4-digit code and type it back before the delete proceeds.
- **Printing**: `printHtmlInNewWindow_()` opens a new window with a self-contained print stylesheet and calls `window.print()` — used for pick lists, assembly specs, customer order documents, supplier requests, and the label sheet. Each of these has a "what to include" checkbox set (photos/prices/drawings) matching the project-context notes.
- **Excel/QR libraries**: `loadScriptOnce_`/`loadXlsxLib_`/`loadJsZipLib_` lazy-load SheetJS/JSZip from CDN only when an import/export action is actually triggered, specifically to keep the initial page load light (documented reasoning in `index.html`'s own comments).
- **AI chat widget**: a floating chat bubble wired to `askFullAssistant`, including file attachment (base64 image/PDF), a pending-confirmation card UI for critical actions, and a full continuous voice mode built on the Web Speech API (`SpeechRecognition` for input, `speechSynthesis` for output, Ukrainian voice preferred) — gracefully hides the mic/voice buttons entirely if the browser doesn't support the API.
- **Spreadsheet view** (`spreadsheet.html` + the `ss*` functions): an inline-editable grid over the full Products table with per-cell save-on-blur, column visibility toggling, and its own export/print flow — functionally a second, denser UI for the same data as the card-based Products page.

No client-side business logic duplicates server logic in any consequential way — calculations shown live in modals (e.g. cost preview while editing a BOM) call the same server endpoints (`getAssemblyEstimatedCost`) rather than reimplementing the math, which matters for migration: the client is thin, the server is authoritative.

---

## 5. RBAC — verified permission matrix

This supersedes `README.md`'s table, which predates several modules (customer orders, production orders, suppliers, Telegram, AI, payroll aren't in it at all) and was checked directly against every `requireAuth_`/`requireRole_` call in the code.

| Capability | admin | storekeeper | viewer |
|---|:---:|:---:|:---:|
| View products/history/reports (non-financial) | ✅ | ✅ | ✅ |
| See supplier prices / cost fields | ✅ | ❌ | ❌ |
| Receive / issue / adjust / move stock | ✅ | ✅ | ❌ |
| Create/edit product | ✅ | ✅ | ❌ |
| Delete product (single or bulk) | ✅ | ❌ | ❌ |
| Import Excel | ✅ | ❌ | ❌ |
| Export Excel (prices hidden if not admin) | ✅ | ✅ | ✅ |
| Create/edit assembly (BOM), produce (reserve-free) | ✅ | ✅ | ❌ |
| Delete assembly | ✅ | ❌ | ❌ |
| Create/start/cancel production order | ✅ | ✅ | ❌ |
| Advance production stage | ✅ | ✅ | ❌ |
| Export production orders (Excel, with cost) | ✅ | ❌ | ❌ |
| Create/manage warehouses | create: ✅/✅, delete: admin only | | |
| Customer orders — view | ✅ | ✅ | ✅ |
| Customer orders — create/edit/delete/generate production or supplier requests | ✅ | ✅ | ❌ |
| Purchase orders — view | ✅ | ✅ | ✅ |
| Purchase orders — create/edit/receive/delete | ✅ | ✅ | ❌ |
| Suppliers — view | ✅ | ✅ | ✅ |
| Suppliers — create/edit | ✅ | ✅ | ❌ |
| Suppliers — delete | ✅ | ❌ | ❌ |
| Finished goods — view | ✅ | ✅ | ✅ |
| Finished goods — status change, QC checks | ✅ | ✅ | ❌ |
| Shipments — view | ✅ | ✅ | ✅ |
| Shipments — create/mark delivered | ✅ | ✅ | ❌ |
| Shipments — delete | ✅ | ❌ | ❌ |
| Inventory sessions — view | ✅ | ✅ | ✅ |
| Inventory sessions — create/count/complete | ✅ | ✅ | ❌ |
| Inventory sessions — delete | ✅ | ❌ | ❌ |
| Employees / payroll (all operations) | ✅ | ❌ | ❌ |
| Warehouse value report | ✅ | ❌ | ❌ |
| Users, VAT rate, backups, dashboard-widget config, branding, Gemini key, Telegram config, daily digest, QC checklist / production-stage list editing | ✅ (admin only, all) | | |
| Own password change | ✅ | ✅ | ✅ |
| AI: simple Довідник / per-order Q&A | ✅ | ✅ | ✅ |
| AI: full assistant (data-reading tools) | ✅ | ✅ | ✅ (payroll tool self-restricts to admin inside the tool) |
| AI: confirm a critical action (stock adjust) | ✅ | ✅ | ❌ |

---

## 6. End-to-end workflows

### 6.1 Two parallel "make a product" paths
There are genuinely **two** ways to consume components against a BOM, and this is easy to conflate:
1. **`Assemblies.produceAssembly`** ("Дати в роботу" from the Вироби page) — no reservation step, immediately checks physical availability and lists-consumes on the spot. Simpler, but does **not** create FinishedGoods serials, does not go through the stage tracker, and is not linked to a customer order.
2. **`ProductionOrders.createProductionOrder` → `startProductionOrder`** — the full lifecycle: create reserves (soft, recomputed on the fly, doesn't touch `Qty`), start physically consumes using the BOM version that was locked in at reservation time, creates one FinishedGoods row per unit with a serial number, splits piecework pay, and (if configured) enters the multi-stage progress tracker.

Both call the same underlying `getAssemblyComponents_`/`calcAssemblyCost_` cost logic, but they are two distinct, independently reachable code paths with different side effects. Any migration must preserve both, not collapse them into one.

### 6.2 Customer order → production
`createCustomerOrder` (header + line items, optional attached document) → per-line `createProductionOrderForItem` *or* whole-order `createProductionOrdersFromCustomerOrder` — this "poetapne" (staged) capability, doing some lines now and others later, is a named, deliberate feature from the project history, not an incidental side effect of the data model.

### 6.3 Shortage → supplier requests (the "no hidden arithmetic" rule)
`previewSupplierRequestsFromCustomerOrder` → `collectShortageGroups_` walks every line's assembly tree recursively. For a sub-assembly component: if it has a `DefaultSupplierId`, it's added as a buy-line for that supplier (full needed quantity, not reduced by what may already be in stock); if not, the function recurses into *its* components (we make it ourselves). For raw product components, they're grouped by `Product.DefaultSupplierId` (blank = "без постачальника" bucket). The **explicit, documented design choice**: never subtract current stock automatically — always show gross need and let the person compare it against the separately-displayed current stock and adjust the quantity by hand before `createPurchaseOrdersFromGroups` commits it. This exists because an earlier automatic-netting version undercounted needs when multiple products in one order shared a component. Any redesign of this screen must preserve "show both numbers, human decides" rather than reintroduce hidden subtraction.

### 6.4 Production cost freezing
`startProductionOrder` computes cost from **current** component prices at the moment of starting (not at planning time), fixes it permanently into the ProductionOrders row (`TotalLocalCostEur`, etc.), and never recomputes it later even if supplier prices subsequently change — this is why historical production reports stay accurate even after a price update.

### 6.5 QC and payroll defect linkage
A QC "rework" result doesn't directly touch payroll, but `getPayrollSummaryReport` cross-references `QCChecks.Result='rework'` back through `FinishedGoods.ProductionOrderID` to each employee's assigned orders, surfacing a per-employee defect count as a KPI — an indirect join done at report time, not a stored relationship.

### 6.6 Virtual warehouses are a view, not a ledger
`WarehouseStock` never stores the default warehouse's own quantity — it's always `Products.Qty − Σ(non-default allocations)`, computed fresh on every read (`getWarehouseContents`, `getWarehouseBreakdown`). This means the "default warehouse" can never technically go out of sync with `Products.Qty`, by construction, at the cost of it not being a real stored fact.

---

## 7. Telegram bot

**Architecture is polling, not webhook — and this is a structural constraint of Apps Script, not a preference.** Documented directly in the code: Apps Script's web app responds to POST `/exec` with an HTTP 302 internal redirect to `googleusercontent.com`, and Telegram's webhook delivery does not follow redirects when checking the response — so every webhook delivery would be marked failed and endlessly retried. The workaround: a 1-minute time-driven trigger (`pollTelegramUpdates_`) calls Telegram's `getUpdates` itself. This constraint disappears entirely on a real server (Phase 0 architecture already earmarks this as a legitimate upgrade, though deprioritized for the initial SaaS build per your decision).

- `/login <user> <pass>` re-uses the exact same `login()` as the web app — no separate credential store.
- Linking is chat-ID → user-ID (`TelegramUsers`), auto-revoked if the underlying user is deactivated.
- `/menu` → category → report → format (Excel/PDF) inline-keyboard flow, backed by a `TG_REPORTS_` catalogue of 18 reports (across 5 categories: stock, production, sales, supply, hr) mapped onto existing whitelisted list/get functions (so Telegram output is guaranteed consistent with the web UI for the same role) and role-gated per report (`roles: ['admin']` for warehouse value and payroll).
- Rate limiting: max 12 messages/chat/minute (`tgRateLimitOk_`), and update-id deduplication (`tgClaimUpdate_`, 6h cache) to survive Telegram's retry-on-slow-response behavior without double-processing.
- File generation reuses Drive/DocumentApp/SpreadsheetApp `getAs()` conversions (the same reliable mechanism as the AI assistant's export tools), after an earlier version using a manual `docs.google.com/export` fetch proved flaky.
- `emergencyStopTelegramBot()` — a manual, no-token, run-from-editor kill switch for when the bot misbehaves and the web UI is inconvenient to reach.

---

## 8. Google Drive usage map

All files get `ANYONE_WITH_LINK / VIEW` sharing (no per-file access control beyond that) and are addressed by URL, not by a stored folder path per item:

| Folder (auto-created, ID cached in Script Properties) | Contents |
|---|---|
| `SHSklad_Photos` | Product photos, assembly photos, assembly drawings (PDF or image — Drive's own thumbnail service is (ab)used to get a printable preview image even for PDFs), employee photos, QC photos, shipment photos, branding assets (logo/print-logo/favicon) |
| `SHSklad_CustomerDocs` | Customer order attached documents |
| `SHSklad_Invoices` | Purchase order attached invoice files |
| (spreadsheet's own Drive file) | Backups — full copies of the `SHSklad_DB` spreadsheet, timestamped filenames, found by `DriveApp.searchFiles('title contains "SHSklad_Backup_"')` |

QR/label printing does **not** use Drive at all — it prints plain article text client-side (see §3.2, Labels.gs). The historical `README.md` reference to `api.qrserver.com`-generated QR codes is stale; that mechanism has been removed from the codebase.

---

## 9. Triggers & scheduled jobs

| Trigger | Handler | Frequency | Purpose |
|---|---|---|---|
| Time-driven | `dailyLowStockDigest_` | daily, 8:00 Europe/Kyiv | Email (MailApp) + best-effort Telegram admin broadcast: low-stock list + 14-day purchase forecast |
| Time-driven | `pollTelegramUpdates_` | every 1 minute | Telegram polling (see §7) |

Both are installed/removed via admin-only whitelisted functions, not fixed at deploy time — an admin can toggle either on/off from Settings.

---

## 10. Known technical debt, risks, and quirks (as observed in code, not opinion)

10.1. **Deliberate "no automatic netting" in shortage calculation** (§6.3) — a preserved product decision, not a bug. Any UI redesign must keep both numbers visible.

10.2. **Stock-mutation concurrency**: `applyStockChange_`, `adjustStock`, `moveStock`, `startProductionOrder`'s per-component list-consume — none of these take a `LockService` lock. Only serial-number generation and Telegram polling do. Under concurrent multi-user edits to the same product, a lost-update race is possible today.

10.3. **Password hashing**: SHA-256, unsalted. Trivially rainbow-table-able if the sheet were ever exposed. No migration path exists in the current code (there's no "force reset" or "upgrade hash on login" logic — that's new work for Phase 4).

10.4. **JSON-in-a-cell columns**: `PickListJson`, `StageHistoryJson`, `AssignedWorkersJson` (ProductionOrders), `ComponentsJson` (AssemblyVersions), `ChecklistJson` (QCChecks) — five places where a real one-to-many relationship is serialized into a single string cell, parsed defensively (`try{JSON.parse}catch{}`) everywhere it's read.

10.5. **Recursive BOM cycle protection exists but is easy to defeat accidentally** — `visitedAssemblyIds`/`nextVisited` pattern in `calcAssemblyCost_` and `collectShortageGroups_` prevents infinite recursion, but a genuine circular reference (A contains B contains A) simply gets silently truncated rather than flagged as a data error to the user.

10.6. **`Supplier` (free text) vs `SupplierId` (FK) coexist** on PurchaseOrders — a PO can have a supplier name with no linked Suppliers record.

10.7. **PurchaseOrderItems keyed by Article text, not ProductID** — intentional (lets a PO reference a not-yet-created product), but means a later product rename doesn't propagate back to historical PO line items.

10.8. **Google Sheets Date/Time cell-format corruption** (§1.4) — a real production incident (`repairAssemblyCostColumns`), guarded against going forward (`numOrZero_`, explicit `setNumberFormat('0.00')` on write) but structurally always possible again in a spreadsheet-as-database model; disappears entirely once migrated to Postgres with real numeric columns.

10.9. **No test suite** anywhere in the repository.

10.10. **Two AI features intentionally have different data-access postures**: the plain "Довідник" chatbot (`askHelpAssistant`) is instruction-only with zero live-data access (can't hallucinate wrong numbers), while `askFullAssistant`/`askAboutCustomerOrder` deliberately do read live data. This split is a safety design choice worth preserving conceptually, even if the new architecture merges the underlying plumbing.

10.11. **`README.md` is stale** relative to the actual code on at least two points: (a) it describes QR-code camera scanning, which was replaced by plain-text article printing (Labels.gs); (b) it predates Customer Orders, Purchase Orders, Production Orders, Suppliers, Shipments, Quality Control, Inventory Sessions, Employees/Payroll, the AI assistant, and Telegram — all of which are now core, heavily-used modules. `SH ERP project context.md` (the owner-maintained running log) is the more current and reliable of the two narrative documents, and was treated as such throughout this analysis.

10.12. **Gemini model pinning risk** — mitigated via the `gemini-flash-latest` alias, but the underlying Google API has reportedly broken integrations multiple times in this project's history even so; worth planning for provider-side instability regardless of alias usage.

---

## 11. Cross-reference: what Phase 0 already flagged, now confirmed with full code detail

The Phase 0 plan ("SH ERP v2 — Phase 0 Plan.md") flagged several risks from a partial read. Full reading confirms all of them and adds specifics:
- Multi-tenancy: none exists today — every sheet is global, no `company_id`-equivalent concept anywhere. Confirmed clean slate for the v2 design.
- Billing: no subscription/plan/payment concept anywhere in the codebase. Confirmed clean slate.
- RBAC: today's 3 roles are hardcoded in multiple places (`Users.gs` validation array, README, this doc's §5) rather than data-driven — the "flexible RBAC, customizable roles per company" requirement from your Phase 0 answers is a genuine new capability, not a port of existing configurability.
- i18n: zero — every user-facing string in every `.html` file and in `JavaScript.html` is hardcoded Ukrainian. Full i18n extraction is new work, not a port.

---

## 12. What Phase 1 deliberately does not include

Per your instructions, this document analyzes and explains — it does not propose schema normalization, does not write migration code, and does not begin any implementation. Phase 2 (architecture) and Phase 3 (PostgreSQL schema design) are the next steps, informed by this document plus the already-agreed Phase 0 decisions (multi-tenant from day one, freeze-and-switch cutover, transparent password re-hash, Telegram deprioritized, i18n-ready from day one, flexible RBAC, billing-ready-but-not-implemented).
