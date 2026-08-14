import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/catalog/ (ProductsController,
 * CompanyUnitsController). Field shapes copied verbatim from
 * dto/create-product.dto.ts, dto/query-products.dto.ts, dto/company-unit.dto.ts,
 * and schema.prisma's Product/CompanyUnit models.
 */

export interface CompanyUnit {
  id: string;
  companyId: string;
  name: string;
}

export interface CreateCompanyUnitInput {
  name: string;
}

export function listCompanyUnits(): Promise<CompanyUnit[]> {
  return apiClient.get<CompanyUnit[]>('company-units');
}

export function createCompanyUnit(dto: CreateCompanyUnitInput): Promise<CompanyUnit> {
  return apiClient.post<CompanyUnit>('company-units', dto);
}

export function deleteCompanyUnit(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`company-units/${id}`);
}

export interface Product {
  id: string;
  companyId: string;
  article: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string | null;
  productGroup: string | null;
  family: string | null;
  type: string | null;
  kind: string | null;
  productLine: string | null;
  barcode: string | null;
  unitId: string;
  unitsPerPackage: DecimalString | null;
  cell: string | null;
  qty: DecimalString;
  minQty: DecimalString;
  localPriceExclVat: DecimalString | null;
  localPriceInclVat: DecimalString | null;
  germanPriceExclVat: DecimalString | null;
  germanPriceInclVat: DecimalString | null;
  sellPriceEur: DecimalString | null;
  weightPerUnitKg: DecimalString | null;
  warrantyMonths: string | null;
  status: string | null;
  manufacturer: string | null;
  manufacturerCode: string | null;
  countryOfOrigin: string | null;
  priceListRef: string | null;
  note: string | null;
  defaultSupplierId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Every optional field in CreateProductDto is `?:`, matching the backend exactly — qty is deliberately absent (it's stock-ledger-derived, never client-settable, see the Inventory module). */
export interface CreateProductInput {
  article: string;
  code?: string;
  name: string;
  description?: string;
  category?: string;
  productGroup?: string;
  family?: string;
  type?: string;
  kind?: string;
  productLine?: string;
  barcode?: string;
  unitId: string;
  unitsPerPackage?: number;
  cell?: string;
  minQty?: number;
  localPriceExclVat?: number;
  localPriceInclVat?: number;
  germanPriceExclVat?: number;
  germanPriceInclVat?: number;
  sellPriceEur?: number;
  weightPerUnitKg?: number;
  warrantyMonths?: string;
  status?: string;
  manufacturer?: string;
  manufacturerCode?: string;
  countryOfOrigin?: string;
  priceListRef?: string;
  note?: string;
  defaultSupplierId?: string;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export interface QueryProductsInput {
  search?: string;
  category?: string;
  barcode?: string;
  supplierId?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  /** "newest" surfaces just-created products (createdAt desc) instead of alphabetical order. */
  sort?: 'name' | 'newest';
}

export interface PaginatedProducts {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

export function queryProducts(query: QueryProductsInput = {}): Promise<PaginatedProducts> {
  return apiClient.get<PaginatedProducts>('products', { query: query as Record<string, string | number | boolean> });
}

export function getProduct(id: string): Promise<Product> {
  return apiClient.get<Product>(`products/${id}`);
}

/** Many products in one call by id — avoids an N-request fan-out resolving productIds into names/photos for a list view (e.g. Stock Levels). */
export function getProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return apiClient.get<Product[]>('products/batch', { query: { ids: ids.join(',') } });
}

export function createProduct(dto: CreateProductInput): Promise<Product> {
  return apiClient.post<Product>('products', dto);
}

export function updateProduct(id: string, dto: UpdateProductInput): Promise<Product> {
  return apiClient.patch<Product>(`products/${id}`, dto);
}

/** Soft-delete (sets deletedAt) — matches the schema-wide convention, never a hard DELETE from the product's own history. */
export function deleteProduct(id: string): Promise<Product> {
  return apiClient.delete<Product>(`products/${id}`);
}

/**
 * One request for the whole selection — NOT `ids.map(deleteProduct)`. A
 * "select all, delete selected" action firing N parallel single-product
 * DELETE calls blew through the backend's per-client rate limit
 * (`app.module.ts`'s `ThrottlerModule`, 100 req/60s) in a real production
 * incident: only however many requests fit under whatever budget was left
 * actually went through, the rest silently 429'd, so most of a large
 * selection never got deleted. This is a single request regardless of
 * selection size.
 */
export function bulkDeleteProducts(ids: string[]): Promise<{ deletedCount: number }> {
  return apiClient.post<{ deletedCount: number }>('products/bulk-delete', { ids });
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportProductsResult {
  created: number;
  updated: number;
  errors: ImportRowError[];
}

/**
 * Bulk import from an .xlsx file — a real multipart upload (`apiClient.postFile`),
 * NOT the R2 presigned-upload flow every other file in this app uses (see
 * `http.ts#postFile`'s header comment for why: this is a one-shot,
 * server-parsed data file, not a durable per-entity `FileAsset`).
 * Field-for-field response shape from `ProductsImportExportService.importProducts`
 * (backend/src/modules/catalog/import-export/): row numbers in `errors` are
 * 1-based and match what a user would see opening the file in Excel
 * (header = row 1).
 */
/**
 * `updateQuantities` defaults to false — see the backend controller's own
 * header comment for the real incident this guards against (a plain
 * re-import of an unmodified export silently posted stock ADJUST
 * movements from every row's now-stale "Кількість" column). Only check
 * this when you actually mean for the file's quantity column to overwrite
 * current stock.
 */
export function importProducts(file: File, updateQuantities = false): Promise<ImportProductsResult> {
  return apiClient.postFile<ImportProductsResult>(`products/import?updateQuantities=${updateQuantities}`, file);
}

/**
 * Exports the full catalog as a real .xlsx workbook (`apiClient.getBlob`,
 * not JSON). Price columns come back blank unless the caller's role has
 * `reports:valuation` — enforced server-side
 * (`ProductsImportExportService.exportProducts`'s own header comment), not
 * duplicated here.
 */
export function exportProducts(): Promise<Blob> {
  return apiClient.getBlob('products/export');
}
