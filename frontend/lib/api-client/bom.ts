import { apiClient } from './http';
import type { DecimalString } from './decimal';

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
  defaultSupplierId: string | null;
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
  defaultSupplierId?: string;
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
/** Many assemblies in one call by id — avoids an N-request fan-out resolving assemblyIds into names (e.g. a customer order's full BOM composition print). Mirrors getProductsByIds. */
export function getAssembliesByIds(ids: string[]): Promise<Assembly[]> {
  return apiClient.get<Assembly[]>('assemblies/batch', { query: { ids: ids.join(',') } });
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
  breakdown: CostBreakdownLine[];
}

export function calculateAssemblyCost(assemblyId: string): Promise<AssemblyCostResult> {
  return apiClient.get<AssemblyCostResult>(`assemblies/${assemblyId}/cost`);
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
