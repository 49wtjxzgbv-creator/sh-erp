import { apiClient } from './http';
import type { DecimalString } from './decimal';
import type { Currency } from './settings';

/**
 * Typed wrappers for backend/src/modules/bom/ (AssembliesController). Field
 * shapes copied verbatim from dto/assembly.dto.ts, dto/assembly-component.dto.ts,
 * dto/produce-assembly.dto.ts, dto/query-assemblies.dto.ts, and
 * schema.prisma's Assembly/AssemblyComponent/AssemblyVersion/
 * AssemblyVersionComponent models.
 *
 * Important, easy to get backwards: the raw CRUD endpoints (create/update/
 * findOne/query/getComponents/getVersions) return Prisma rows, so their
 * Decimal fields (laborCostPerUnit, qtyPerUnit, etc.) are `DecimalString`.
 * But `calculateCost`/`checkAvailability`/`produce` return
 * *computed* results built from plain `Number(...)` math in
 * assemblies.service.ts, not Prisma rows — those fields are real JSON
 * numbers. Mixing the two conventions up in either direction is exactly the
 * kind of bug `lib/api-client/decimal.ts` exists to prevent, so double
 * check against the field comments below before copying a pattern from one
 * section to the other.
 */

export type ComponentType = 'PRODUCT' | 'ASSEMBLY';

export interface AssemblyComponent {
  id: string;
  companyId: string;
  assemblyId: string;
  componentType: ComponentType;
  productId: string | null;
  subAssemblyId: string | null;
  warehouseId: string | null;
  qtyPerUnit: DecimalString;
}

export interface Assembly {
  id: string;
  companyId: string;
  name: string;
  article: string | null;
  note: string | null;
  laborCostPerUnit: DecimalString;
  packagingCostPerUnit: DecimalString;
  deliveryCostPerUnit: DecimalString;
  otherCostPerUnit: DecimalString;
  /** Quotations module (2026-08-27) — the sale-price starting point for BASE_PRICE-method quotation lines. Independent of cost (laborCostPerUnit etc.) and of Product.sellPriceEur (a cost input, not a retail price) — null until someone sets it. */
  baseSalePriceEur: DecimalString | null;
  /** Multi-currency module (2026-10-29) — covers laborCostPerUnit/packagingCostPerUnit/deliveryCostPerUnit/otherCostPerUnit/baseSalePriceEur above, NOT germanPriceEur below (always EUR-denominated benchmark). */
  currency: Currency;
  /** Pure benchmarking input — the going price for this same item in Germany, entered manually for comparison against our own calculated cost on the BOM cost page. Never used by any cost/pricing/quotation calculation. */
  germanPriceEur: DecimalString | null;
  defaultSupplierId: string | null;
  /** Shipment-calculation module (2026-10-28) — packaging hierarchy used only to compute place count (boxes/pallets) when previewing a Shipment. Weight per unit stays computed (AssembliesService#calculateWeight), never stored here. */
  unitsPerBox: number | null;
  boxesPerPallet: number | null;
  boxLengthCm: DecimalString | null;
  boxWidthCm: DecimalString | null;
  boxHeightCm: DecimalString | null;
  /** Load-plan weight-aware stacking (2026-10-30) — whether anything may rest on top of this assembly's own box at all. */
  boxStackable: boolean;
  /** Combined weight (kg) this box can bear on top of it when `boxStackable`. `null` means unlimited. */
  boxMaxStackWeightKg: DecimalString | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Only present on the single-assembly GET (findOne) response, not on list/create/update. */
  components?: AssemblyComponent[];
}

export interface CreateAssemblyInput {
  name: string;
  article?: string;
  note?: string;
  laborCostPerUnit?: number;
  packagingCostPerUnit?: number;
  deliveryCostPerUnit?: number;
  otherCostPerUnit?: number;
  // Nullable DB columns — explicit `null` (not just omitting the field)
  // is how an update actually CLEARS a previously-set value back to unset.
  baseSalePriceEur?: number | null;
  germanPriceEur?: number | null;
  currency?: Currency;
  defaultSupplierId?: string;
  unitsPerBox?: number | null;
  boxesPerPallet?: number | null;
  boxLengthCm?: number | null;
  boxWidthCm?: number | null;
  boxHeightCm?: number | null;
  boxStackable?: boolean;
  boxMaxStackWeightKg?: number | null;
}
export type UpdateAssemblyInput = Partial<CreateAssemblyInput>;

export interface QueryAssembliesInput {
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface PaginatedAssemblies {
  items: Assembly[];
  total: number;
  limit: number;
  offset: number;
}

export function queryAssemblies(query: QueryAssembliesInput = {}): Promise<PaginatedAssemblies> {
  return apiClient.get<PaginatedAssemblies>('assemblies', { query: query as Record<string, string | number | boolean> });
}
export function getAssembly(id: string): Promise<Assembly> {
  return apiClient.get<Assembly>(`assemblies/${id}`);
}
/** Many assemblies in one call by id — avoids an N-request fan-out resolving assemblyIds into names (e.g. a customer order's full BOM composition print). Mirrors getProductsByIds — POST, not GET+query, see that function's own comment. */
export function getAssembliesByIds(ids: string[]): Promise<Assembly[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return apiClient.post<Assembly[]>('assemblies/batch', { ids });
}
export function createAssembly(dto: CreateAssemblyInput): Promise<Assembly> {
  return apiClient.post<Assembly>('assemblies', dto);
}
export function updateAssembly(id: string, dto: UpdateAssemblyInput): Promise<Assembly> {
  return apiClient.patch<Assembly>(`assemblies/${id}`, dto);
}
export function deleteAssembly(id: string): Promise<Assembly> {
  return apiClient.delete<Assembly>(`assemblies/${id}`);
}
/** "Дублювати специфікацію" (2026-10-07) — copies header fields + current BOM lines into a new assembly (not photo/documents/suppliers), snapshotting the copy as version 1. */
export function duplicateAssembly(id: string): Promise<Assembly> {
  return apiClient.post<Assembly>(`assemblies/${id}/duplicate`);
}

export interface AssemblyComponentLineInput {
  componentType: ComponentType;
  /** Required when componentType = PRODUCT; must be omitted otherwise. */
  productId?: string;
  /** Required when componentType = ASSEMBLY; must be omitted otherwise. Save-time-rejected if it would create a cycle (409). */
  subAssemblyId?: string;
  warehouseId?: string;
  qtyPerUnit: number;
}

export function getAssemblyComponents(assemblyId: string): Promise<AssemblyComponent[]> {
  return apiClient.get<AssemblyComponent[]>(`assemblies/${assemblyId}/components`);
}

/** One linked supplier for an assembly ("виріб"), with its own optional price — mirrors ProductSupplierLink in api-client/catalog.ts. */
export interface AssemblySupplierLink {
  id: string;
  supplierId: string;
  supplierName: string;
  price: DecimalString | null;
  isDefault: boolean;
}

export interface SetAssemblySupplierInput {
  supplierId: string;
  price?: number;
  isDefault?: boolean;
}

export function getAssemblySuppliers(assemblyId: string): Promise<AssemblySupplierLink[]> {
  return apiClient.get<AssemblySupplierLink[]>(`assemblies/${assemblyId}/suppliers`);
}

/** Replaces the full linked-supplier list for this assembly — no partial-update endpoint, same convention as setAssemblyComponents. */
export function setAssemblySuppliers(assemblyId: string, suppliers: SetAssemblySupplierInput[]): Promise<AssemblySupplierLink[]> {
  return apiClient.put<AssemblySupplierLink[]>(`assemblies/${assemblyId}/suppliers`, { suppliers });
}

/** Replaces the full BOM line list — there is no partial-update endpoint, by design (see assembly-component.dto.ts). Always writes a new immutable AssemblyVersion. */
export function setAssemblyComponents(
  assemblyId: string,
  components: AssemblyComponentLineInput[],
): Promise<{ version: AssemblyVersion; components: AssemblyComponent[] }> {
  return apiClient.put(`assemblies/${assemblyId}/components`, { components });
}

export interface AssemblyVersion {
  id: string;
  companyId: string;
  assemblyId: string;
  versionNumber: number;
  createdById: string;
  createdAt: string;
  /** Only present on the single-version GET, not on the list. */
  components?: AssemblyComponent[];
}

export function getAssemblyVersions(assemblyId: string): Promise<AssemblyVersion[]> {
  return apiClient.get<AssemblyVersion[]>(`assemblies/${assemblyId}/versions`);
}
export function getAssemblyVersion(assemblyId: string, versionId: string): Promise<AssemblyVersion> {
  return apiClient.get<AssemblyVersion>(`assemblies/${assemblyId}/versions/${versionId}`);
}

// ---- Computed results (plain numbers, NOT DecimalString — see file header) ----

export interface CostBreakdownLine {
  componentType: ComponentType;
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  unitCost: number;
  lineCost: number;
}

/** Costed from Product.sellPriceEur — the one price every calculation in this app is pinned to (localPriceExclVat/germanPriceExclVat/localPriceInclVat/germanPriceInclVat are informational reference fields only, never part of a cost total). */
export interface AssemblyCostResult {
  assemblyId: string;
  costPerUnit: number;
  /** Multi-currency module (2026-10-29) — the currency `costPerUnit` is actually expressed in (this assembly's own `currency`), not necessarily EUR. A caller combining this with another currency's amount MUST convert first — see lib/finance-format.ts#convertWithRates. */
  currency: Currency;
  breakdown: CostBreakdownLine[];
}

export function calculateAssemblyCost(assemblyId: string): Promise<AssemblyCostResult> {
  return apiClient.get<AssemblyCostResult>(`assemblies/${assemblyId}/cost`);
}

export interface WeightBreakdownLine {
  componentType: ComponentType;
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  /** `null` = not set on the Product (or, for an ASSEMBLY line, somewhere inside that sub-assembly) — NOT a confirmed zero. */
  unitWeightKg: number | null;
  lineWeightKg: number;
  /** False if this line (or, recursively, anything under it) has a missing weight. */
  complete: boolean;
}

/** Weighed from Product.weightPerUnitKg — missing values contribute 0 to `weightPerUnitKg`, with `complete: false` flagging that the total understates reality (see `WeightBreakdownLine`). */
export interface AssemblyWeightResult {
  assemblyId: string;
  weightPerUnitKg: number;
  complete: boolean;
  breakdown: WeightBreakdownLine[];
}

export function calculateAssemblyWeight(assemblyId: string): Promise<AssemblyWeightResult> {
  return apiClient.get<AssemblyWeightResult>(`assemblies/${assemblyId}/weight`);
}

export interface GermanPriceBreakdownLine {
  componentType: ComponentType;
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  /** PRODUCT line: Product.germanPriceInclVat. ASSEMBLY line: the sub-assembly's own germanPriceEur, read directly (NOT a further recursive rollup — see the backend's own header comment on calculateGermanPriceFromBom for why). `null` = not set, not a confirmed zero. */
  unitGermanPrice: number | null;
  lineGermanPrice: number;
  complete: boolean;
}

/** "додай можливість рахувати у специфікаціях ціна виробу в німеччмні з склад бум" (2026-10-15) — sum of this assembly's DIRECT BOM lines' own German prices only, one level deep (not recursive like cost/weight). Missing values contribute 0, with `complete: false` flagging the gap. A suggestion the user applies by hand into `germanPriceEur` — never written automatically. */
export interface AssemblyGermanPriceResult {
  assemblyId: string;
  germanPricePerUnit: number;
  complete: boolean;
  breakdown: GermanPriceBreakdownLine[];
}

export function calculateAssemblyGermanPrice(assemblyId: string): Promise<AssemblyGermanPriceResult> {
  return apiClient.get<AssemblyGermanPriceResult>(`assemblies/${assemblyId}/german-price`);
}

export interface CostVsGermanPriceLine {
  componentType: ComponentType;
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  /** PRODUCT: Product.sellPriceEur. ASSEMBLY: that sub-assembly's own FULL recursive cost — not a one-level read. */
  unitCost: number;
  /** PRODUCT: Product.germanPriceInclVat. ASSEMBLY: the sub-assembly's own stored germanPriceEur, never re-derived from its own components. `null` = not set. */
  unitGermanPrice: number | null;
  lineCost: number;
  lineGermanPrice: number;
  /** lineGermanPrice − lineCost. */
  lineDelta: number;
  germanPriceMissing: boolean;
}

/** "додай можливість робити такий звіт у будь якій специфікації" (2026-10-17) — the exact cost-vs-German-price line-by-line breakdown worked out by hand for article 279785, available for any assembly. See the backend's own header comment on compareCostToGermanPrice for why cost stays fully recursive while the German side stays one level deep, and for the staleness-detection reasoning. */
export interface AssemblyCostVsGermanPriceResult {
  assemblyId: string;
  costPerUnit: number;
  ownLaborCost: number;
  ownPackagingCost: number;
  ownDeliveryCost: number;
  ownOtherCost: number;
  storedGermanPriceEur: number | null;
  freshGermanPricePerUnit: number;
  freshGermanPriceComplete: boolean;
  /** True when the saved germanPriceEur no longer matches a fresh one-level recalculation — a component price or a sub-assembly's own German price changed since it was last applied. */
  isStoredGermanPriceStale: boolean;
  lines: CostVsGermanPriceLine[];
}

export function compareAssemblyCostToGermanPrice(assemblyId: string): Promise<AssemblyCostVsGermanPriceResult> {
  return apiClient.get<AssemblyCostVsGermanPriceResult>(`assemblies/${assemblyId}/cost-vs-german-price`);
}

export interface AvailabilityResult {
  assemblyId: string;
  qty: number;
  sufficient: boolean;
  requirements: Array<{ productId: string; needed: number }>;
  shortages: Array<{ productId: string; needed: number; available: number; shortage: number }>;
}

export function checkAssemblyAvailability(assemblyId: string, qty: number): Promise<AvailabilityResult> {
  return apiClient.post<AvailabilityResult>(`assemblies/${assemblyId}/check-availability`, { qty });
}

export interface SubAssemblyReservationBreakdownLine {
  customerOrderId: string;
  orderNumber: string | null;
  clientName: string;
  qty: number;
}

export interface SubAssemblyNeed {
  assemblyId: string;
  name: string;
  article: string | null;
  /** Total qty needed across every branch of the BOM tree it appears in. */
  qtyNeeded: number;
  /** Current IN_STOCK FinishedGood count. */
  qtyInStock: number;
  /** Sum of every OTHER order's "Зі складу" claim on this assembly, already sitting in qtyInStock. */
  reservedByOthers: number;
  /** Per-order breakdown backing reservedByOthers. */
  reservedBreakdown: SubAssemblyReservationBreakdownLine[];
}

/** Every distinct sub-assembly needed to build `qty` units of this assembly, at any BOM depth. */
export function getSubAssembliesNeeded(assemblyId: string, qty: number): Promise<SubAssemblyNeed[]> {
  return apiClient.get<SubAssemblyNeed[]>(`assemblies/${assemblyId}/sub-assemblies-needed`, { query: { qty } });
}

export interface ProduceAssemblyInput {
  qty: number;
  warehouseId?: string;
  comment?: string;
}

export interface ProduceAssemblyResult {
  assemblyId: string;
  qtyProduced: number;
  warehouseId: string;
  consumedMovements: Array<{ id: string; productId: string; qtyDelta: string }>;
  costEstimate: {
    costPerUnit: number;
    totalCost: number;
  };
}

/**
 * The reservation-free "produce" path — distinct from the full
 * ProductionOrder lifecycle (Module 6). Throws an ApiError with a
 * `shortages` array in the body if stock is insufficient (backend returns
 * this as the BadRequestException's structured message, not a plain
 * string) — callers should run checkAssemblyAvailability() first to show
 * shortages proactively rather than relying on this error alone.
 */
export function produceAssembly(assemblyId: string, dto: ProduceAssemblyInput): Promise<ProduceAssemblyResult> {
  return apiClient.post<ProduceAssemblyResult>(`assemblies/${assemblyId}/produce`, dto);
}
