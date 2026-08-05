/**
 * Legacy Google Sheet schemas — the real, exact tab names and column
 * header strings from the source Apps Script system, NOT paraphrased.
 *
 * Sourced by reading `Setup.gs` (`ensureDatabase_`, the sole place sheets
 * are created — `ensureColumnsExist_` only ever *appends* columns, never
 * reorders, per its own header comment) and `Code.gs` (the `SHEET_*` tab
 * name constants), confirmed against the individual entity `.gs` files for
 * the 5 JSON-blob columns' actual shapes. Every header string below is
 * quoted verbatim from source, not translated or normalized — a wrong
 * column name here would silently corrupt a real migration.
 *
 * IMPORTANT caveat, disclosed rather than assumed away: `ensureColumnsExist_`
 * only appends missing columns at the end of a live sheet, so a real
 * production spreadsheet that has been through several schema versions
 * could have columns in a different PHYSICAL order than the arrays below
 * (e.g. `DefaultSupplierId` was added to `Products`/`Assemblies` after the
 * sheet already existed with earlier columns). `extract.ts` therefore never
 * assumes positional order — it builds a `name -> columnIndex` map from the
 * sheet's actual row 1 at read time (exactly like the legacy app's own
 * `indexMap_()` helper does), and uses the header strings below only as
 * lookup KEYS into that map, never as fixed positions. `TelegramUsers`
 * (`SHEET_TELEGRAM_USERS`, Code.gs:33) is deliberately excluded — deferred
 * per Phase 0, confirmed still out of scope by the Phase 3 §5 sheet-coverage
 * table.
 *
 * `migrateProductsSchema_` (Setup.gs) additionally reveals that some very
 * old, never-fully-migrated Products sheets could still carry the
 * pre-rename columns `PurchasePrice`/`GermanPriceEUR` instead of
 * `LocalPriceInclVat`/`GermanPriceInclVat` — `extract.ts` falls back to
 * those old names too, see `PRODUCT_LEGACY_COLUMN_ALIASES` below.
 */

export interface SheetSchema {
  /** The literal Google Sheet tab name (SHEET_* constant in Code.gs). */
  tabName: string;
  /** Exact column header strings, in the order a freshly-created sheet has them. Used as lookup keys, not positions — see module header comment. */
  headers: readonly string[];
  /** Column(s) whose cell value is a JSON.stringify'd blob, not a scalar. Always present (possibly empty) so every schema entry has a consistent shape — TypeScript can then access `.jsonBlobColumns` on any entry without a per-member `in` narrowing check. */
  jsonBlobColumns: readonly string[];
}

/**
 * Declared as an explicit literal union (not derived via `keyof typeof
 * SHEET_SCHEMAS`) so `SHEET_SCHEMAS` itself can be typed as
 * `Record<SheetKey, SheetSchema>` — every entry structurally satisfies the
 * full `SheetSchema` interface (including the always-present
 * `jsonBlobColumns` array), so property access is uniform across every key
 * without TypeScript narrowing gymnastics.
 */
export type SheetKey =
  | 'users' | 'products' | 'history' | 'units' | 'settings' | 'assemblies'
  | 'assemblyComponents' | 'productionOrders' | 'warehouses' | 'warehouseStock'
  | 'purchaseOrders' | 'purchaseOrderItems' | 'productionStages' | 'customerOrders'
  | 'customerOrderItems' | 'finishedGoods' | 'assemblyVersions' | 'inventorySessions'
  | 'inventoryItems' | 'qcChecklist' | 'qcChecks' | 'shipments' | 'shipmentItems'
  | 'employees' | 'payrollEntries' | 'suppliers';

export const SHEET_SCHEMAS: Record<SheetKey, SheetSchema> = {
  users: {
    tabName: 'Users',
    headers: ['ID', 'Login', 'PasswordHash', 'Role', 'FullName', 'Active', 'CreatedAt'],
    jsonBlobColumns: [],
  },
  products: {
    tabName: 'Products',
    headers: [
      'ID', 'Article', 'Code', 'Name', 'Description',
      'Category', 'ProductGroup', 'Family', 'Type', 'Kind', 'ProductLine', 'Barcode',
      'Unit', 'UnitsPerPackage', 'Cell', 'Qty', 'MinQty',
      'LocalPriceExclVat', 'LocalPriceInclVat', 'GermanPriceExclVat', 'GermanPriceInclVat', 'SellPriceEUR',
      'WeightPerUnitKg', 'WarrantyMonths', 'Status',
      'Manufacturer', 'ManufacturerCode', 'CountryOfOrigin',
      'PriceListRef', 'Note', 'PhotoUrl', 'QrUrl', 'CreatedAt', 'UpdatedAt', 'DefaultSupplierId',
    ],
    jsonBlobColumns: [],
  },
  history: {
    tabName: 'History',
    headers: ['Timestamp', 'User', 'Action', 'Article', 'Name', 'Qty', 'Comment'],
    jsonBlobColumns: [],
  },
  units: {
    tabName: 'Units',
    headers: ['Name'],
    jsonBlobColumns: [],
  },
  settings: {
    tabName: 'Settings',
    headers: ['Key', 'Value'],
    jsonBlobColumns: [],
  },
  assemblies: {
    tabName: 'Assemblies',
    headers: [
      'ID', 'Name', 'Article', 'Note', 'PhotoUrl', 'CreatedAt', 'UpdatedAt',
      'LaborCostPerUnit', 'PackagingCostPerUnit', 'DeliveryCostPerUnit', 'OtherCostPerUnit',
      'DrawingFileUrl', 'DrawingFileName', 'DrawingMimeType', 'DrawingOriginalUrl', 'DefaultSupplierId',
    ],
    jsonBlobColumns: [],
  },
  assemblyComponents: {
    tabName: 'AssemblyComponents',
    headers: ['ID', 'AssemblyID', 'ProductID', 'Qty', 'WarehouseID', 'ComponentType', 'SubAssemblyID'],
    jsonBlobColumns: [],
  },
  productionOrders: {
    tabName: 'ProductionOrders',
    headers: [
      'ID', 'AssemblyID', 'AssemblyName', 'UnitsPlanned', 'Status',
      'User', 'CreatedAt', 'CompletedAt', 'Comment', 'PickListJson',
      'TotalLocalCostEur', 'TotalGermanCostEur', 'CurrentStageIndex', 'StageHistoryJson', 'BOMVersionNumber',
      'LaborCostEur', 'PackagingCostEur', 'DeliveryCostEur', 'OtherCostEur', 'FullCostEur', 'AssignedWorkersJson',
    ],
    jsonBlobColumns: ['PickListJson', 'StageHistoryJson', 'AssignedWorkersJson'],
  },
  warehouses: {
    tabName: 'Warehouses',
    headers: ['ID', 'Name', 'IsDefault', 'CreatedAt'],
    jsonBlobColumns: [],
  },
  warehouseStock: {
    tabName: 'WarehouseStock',
    headers: ['ID', 'ProductID', 'WarehouseID', 'Qty'],
    jsonBlobColumns: [],
  },
  purchaseOrders: {
    tabName: 'PurchaseOrders',
    headers: [
      'ID', 'Supplier', 'SupplierId', 'Status', 'OrderDate', 'ExpectedDeliveryDate',
      'InvoiceFileUrl', 'InvoiceFileName', 'Comment', 'CreatedBy', 'CreatedAt', 'SourceCustomerOrderID',
    ],
    jsonBlobColumns: [],
  },
  purchaseOrderItems: {
    tabName: 'PurchaseOrderItems',
    headers: ['ID', 'PurchaseOrderID', 'Article', 'ProductName', 'QtyOrdered', 'QtyReceived', 'ExpectedPrice', 'ActualPrice'],
    jsonBlobColumns: [],
  },
  productionStages: {
    tabName: 'ProductionStages',
    headers: ['ID', 'Name', 'SortOrder'],
    jsonBlobColumns: [],
  },
  customerOrders: {
    tabName: 'CustomerOrders',
    headers: [
      'ID', 'OrderNumber', 'ClientName', 'ContactPerson', 'Deadline', 'Priority', 'Status',
      'DocumentFileUrl', 'DocumentFileName', 'Comment', 'CreatedBy', 'CreatedAt',
    ],
    jsonBlobColumns: [],
  },
  customerOrderItems: {
    tabName: 'CustomerOrderItems',
    headers: ['ID', 'CustomerOrderID', 'AssemblyID', 'AssemblyName', 'Qty', 'ProductionOrderID'],
    jsonBlobColumns: [],
  },
  finishedGoods: {
    tabName: 'FinishedGoods',
    headers: [
      'ID', 'SerialNumber', 'AssemblyID', 'AssemblyName', 'ProductionOrderID',
      'ManufactureDate', 'Status', 'CustomerOrderID', 'Comment',
      'UnitCostLocalEur', 'UnitCostGermanEur', 'ConsumedInProductionOrderID',
    ],
    jsonBlobColumns: [],
  },
  assemblyVersions: {
    tabName: 'AssemblyVersions',
    headers: ['ID', 'AssemblyID', 'VersionNumber', 'ComponentsJson', 'CreatedAt', 'CreatedBy'],
    jsonBlobColumns: ['ComponentsJson'],
  },
  inventorySessions: {
    tabName: 'InventorySessions',
    headers: ['ID', 'Name', 'Status', 'StartedBy', 'StartedAt', 'CompletedAt', 'Comment'],
    jsonBlobColumns: [],
  },
  inventoryItems: {
    tabName: 'InventoryItems',
    headers: ['ID', 'InventorySessionID', 'ProductID', 'Article', 'ProductName', 'ExpectedQty', 'ActualQty', 'Counted'],
    jsonBlobColumns: [],
  },
  qcChecklist: {
    tabName: 'QCChecklist',
    headers: ['ID', 'Name', 'SortOrder'],
    jsonBlobColumns: [],
  },
  qcChecks: {
    tabName: 'QCChecks',
    headers: ['ID', 'FinishedGoodID', 'SerialNumber', 'ChecklistJson', 'PhotoUrl', 'Result', 'Inspector', 'CheckedAt', 'Comment'],
    jsonBlobColumns: ['ChecklistJson'],
  },
  shipments: {
    tabName: 'Shipments',
    headers: [
      'ID', 'Carrier', 'WaybillNumber', 'PackageCount', 'Weight', 'Dimensions',
      'PhotoUrl', 'ShipDate', 'DeliveryDate', 'Status', 'CustomerOrderID', 'Comment', 'CreatedBy', 'CreatedAt',
    ],
    jsonBlobColumns: [],
  },
  shipmentItems: {
    tabName: 'ShipmentItems',
    headers: ['ID', 'ShipmentID', 'FinishedGoodID', 'SerialNumber'],
    jsonBlobColumns: [],
  },
  employees: {
    tabName: 'Employees',
    headers: ['ID', 'FullName', 'Position', 'Phone', 'PhotoUrl', 'HireDate', 'Status', 'Notes'],
    jsonBlobColumns: [],
  },
  payrollEntries: {
    tabName: 'PayrollEntries',
    headers: [
      'ID', 'EmployeeID', 'Type', 'ProductionOrderID', 'AssemblyName', 'UnitsProduced',
      'Amount', 'EntryDate', 'Comment', 'CreatedBy', 'CreatedAt',
    ],
    jsonBlobColumns: [],
  },
  suppliers: {
    tabName: 'Suppliers',
    headers: ['ID', 'Name', 'ContactPerson', 'Phone', 'Email', 'Notes', 'CreatedAt'],
    jsonBlobColumns: [],
  },
};

/**
 * `migrateProductsSchema_` (Setup.gs) renames `PurchasePrice` -> ... ->
 * `LocalPriceInclVat` and `GermanPriceEUR` -> `GermanPriceInclVat` on live
 * sheets that predate those renames. A spreadsheet that was created a long
 * time ago and never re-opened (so the lazy rename never ran) could still
 * carry the old names. `extract.ts` checks these aliases when the canonical
 * header is absent, and reports which alias (if any) it fell back to in the
 * extracted snapshot's metadata, so `transform` doesn't have to guess and a
 * human reviewing the snapshot can see it happened.
 */
export const PRODUCT_LEGACY_COLUMN_ALIASES: Record<string, string> = {
  LocalPriceInclVat: 'PurchasePrice',
  GermanPriceInclVat: 'GermanPriceEUR',
};

/** All 26 migratable sheets — `TelegramUsers` is deliberately absent (Phase 0). */
export const ALL_SHEET_KEYS = Object.keys(SHEET_SCHEMAS) as SheetKey[];
