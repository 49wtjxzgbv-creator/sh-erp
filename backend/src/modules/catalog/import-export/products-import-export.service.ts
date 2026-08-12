import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../../common/decorators/current-user.decorator';
import { loadPermissionSet } from '../../../common/authorization/permission-set.util';
import { AuditService } from '../../audit/audit.service';
import { StockService } from '../../inventory/stock.service';
import {
  EXPORT_HEADERS,
  buildHeaderMap,
  mapRowToProduct,
  type MappedProductRow,
} from './product-field-synonyms';

export interface ImportRowError {
  row: number; // 1-based, matching the row number a user would see in Excel (header = row 1)
  message: string;
}

export interface ImportProductsResult {
  created: number;
  updated: number;
  errors: ImportRowError[];
}

/** Every editable, non-computed Product column an import row can set. `qty` is handled separately (ledger, see below), `id`/timestamps/company/unit are handled separately too. */
const PRODUCT_TEXT_FIELDS = [
  'code', 'name', 'description', 'category', 'productGroup', 'family', 'type', 'kind',
  'productLine', 'barcode', 'cell', 'warrantyMonths', 'status', 'manufacturer',
  'manufacturerCode', 'countryOfOrigin', 'priceListRef', 'note',
] as const;
const PRODUCT_NUMERIC_FIELDS = [
  'unitsPerPackage', 'minQty', 'localPriceExclVat', 'localPriceInclVat',
  'germanPriceExclVat', 'germanPriceInclVat', 'sellPriceEur', 'weightPerUnitKg',
] as const;

/**
 * Excel bulk import/export for the Product catalog — ported from the legacy
 * `ImportExport.gs` (`importProducts`/`exportProducts`), ownership of which
 * moved server-side here rather than staying client-parsed (legacy used
 * SheetJS in the browser and sent already-parsed JSON rows to Apps Script;
 * this backend has no client-side spreadsheet-parsing precedent anywhere
 * else, so the whole file — upload through parse through write — happens
 * in one request here via `exceljs`). Fuzzy multi-language header matching
 * (`buildHeaderMap`/`FIELD_SYNONYMS`) is preserved exactly; three
 * deliberate behavior changes are forced by the schema having evolved
 * since the legacy sheet — each is called out at its own point below, not
 * just in this header comment.
 *
 * File transport is a genuinely new pattern for this backend, disclosed
 * here rather than silently introduced: every other file transfer in this
 * app goes through R2 presigned-upload (`FilesService`, browser PUTs
 * directly to R2, never through the NestJS API — see `frontend/README.md`).
 * That pattern is built for durable, per-entity attachments browsed later;
 * a bulk import is a one-shot blob that needs synchronous server-side
 * parsing before anything durable exists to attach it to, so this uses
 * NestJS's standard `FileInterceptor` (multer, in-memory buffer, never
 * written to disk) instead — see `products.controller.ts`'s import route
 * for the size/mimetype limits.
 */
@Injectable()
export class ProductsImportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockService: StockService,
  ) {}

  async importProducts(user: RequestUser, fileBuffer: Buffer, updateQuantities = false): Promise<ImportProductsResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as any);
    } catch {
      throw new BadRequestException('Could not read this file as an .xlsx workbook.');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('The file is empty (no data rows found).');
    }

    const headerRow = worksheet.getRow(1);
    const rawHeaders: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell) => rawHeaders.push(String(cell.value ?? '').trim()));

    const headerMap = buildHeaderMap(rawHeaders);
    const mappedFields = new Set(Object.values(headerMap));
    if (!mappedFields.has('article') || !mappedFields.has('name')) {
      throw new BadRequestException(
        'Could not find "Article"/"Артикул" and/or "Name"/"Назва" columns in this file (check the column headers).',
      );
    }

    // Resolve every warehouse-agnostic qty delta against ONE default
    // warehouse, same "no silent fallback" idiom Procurement/Production
    // use (purchase-orders.service.ts, production-orders.service.ts) —
    // checked once up front, not per row, since it's a company-level
    // precondition, not a per-row one.
    const defaultWarehouse = await this.prisma.tenant.warehouse.findFirst({
      where: { isDefault: true, deletedAt: null },
    });

    const existingUnits = await this.prisma.tenant.companyUnit.findMany();
    const unitsByLowerName = new Map<string, { id: string; name: string }>(
      existingUnits.map((u: any) => [String(u.name).toLowerCase(), { id: u.id, name: u.name }]),
    );

    let created = 0;
    let updated = 0;
    const errors: ImportRowError[] = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      if (row.cellCount === 0) continue;

      const rawRow: Record<string, unknown> = {};
      let hasAnyValue = false;
      rawHeaders.forEach((header, colIndex) => {
        const value = row.getCell(colIndex + 1).value;
        rawRow[header] = this.cellToPlainValue(value);
        if (String(rawRow[header] ?? '').trim() !== '') hasAnyValue = true;
      });
      // A fully blank row (e.g. a section separator) is normal file
      // structure, not an error — skip it silently, same as legacy.
      if (!hasAnyValue) continue;

      const mapped = mapRowToProduct(rawRow, headerMap);
      const article = String(mapped.article ?? '').trim();
      const name = String(mapped.name ?? '').trim();
      if (!article || !name) {
        errors.push({ row: rowNumber, message: 'Missing article or name.' });
        continue;
      }

      try {
        const outcome = await this.importOneRow(user, mapped, unitsByLowerName, defaultWarehouse?.id ?? null, updateQuantities);
        if (outcome === 'created') created++;
        else updated++;
      } catch (err) {
        errors.push({ row: rowNumber, message: err instanceof Error ? err.message : 'Unknown error.' });
      }
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'product.imported',
      entityType: 'Product',
      entityId: user.companyId,
      after: { created, updated, errorCount: errors.length },
    });

    return { created, updated, errors };
  }

  private async importOneRow(
    user: RequestUser,
    row: MappedProductRow,
    unitsByLowerName: Map<string, { id: string; name: string }>,
    defaultWarehouseId: string | null,
    updateQuantities: boolean,
  ): Promise<'created' | 'updated'> {
    const article = String(row.article).trim();

    // Unit resolution: legacy stored unit as free text directly on the
    // product row, so any spelling "just worked". `Product.unitId` is now a
    // required FK to `CompanyUnit` (Phase 3 decision 1), so an imported unit
    // name is resolved case-insensitively against existing units and
    // auto-created if genuinely new — preserving the legacy "any text is
    // fine" ergonomics rather than making an import fail on a unit that
    // simply hasn't been added to Settings yet. If a row has no recognizable
    // unit column at all, an existing product keeps its current unit; a
    // brand-new product falls back to the company's first unit alphabetically
    // (seeded companies always have at least the 6 defaults — see
    // company-units.service.ts) rather than failing the whole row over a
    // single missing, genuinely optional-in-practice column.
    let unitId: string | undefined;
    const unitText = typeof row.unit === 'string' ? row.unit.trim() : '';
    if (unitText) {
      const key = unitText.toLowerCase();
      let unit = unitsByLowerName.get(key);
      if (!unit) {
        const createdUnit = await this.prisma.tenant.companyUnit.create({ data: { name: unitText } as any });
        unit = { id: createdUnit.id, name: createdUnit.name };
        unitsByLowerName.set(key, unit);
      }
      unitId = unit.id;
    }

    const data: Record<string, unknown> = {};
    for (const field of PRODUCT_TEXT_FIELDS) {
      if (row[field] !== undefined) data[field] = row[field];
    }
    for (const field of PRODUCT_NUMERIC_FIELDS) {
      if (row[field] !== undefined) data[field] = row[field];
    }

    const existing = await this.prisma.tenant.product.findFirst({ where: { article } });
    const importedQty = row.qty !== undefined ? Number(row.qty) : undefined;

    if (existing) {
      if (unitId) data.unitId = unitId;
      const updated = await this.prisma.tenant.product.update({ where: { id: existing.id }, data });
      if (updateQuantities) await this.applyImportedQty(user, updated.id, importedQty, Number(existing.qty), defaultWarehouseId);
      return 'updated';
    }

    if (!unitId) {
      const fallback = [...unitsByLowerName.values()].sort((a, b) => a.name.localeCompare(b.name))[0];
      if (!fallback) {
        throw new Error('No unit column recognized in this file and the company has no units configured yet.');
      }
      unitId = fallback.id;
    }

    const created = await this.prisma.tenant.product.create({
      data: { ...data, article, name: String(row.name), unitId } as any,
    });
    await this.applyImportedQty(user, created.id, importedQty, 0, defaultWarehouseId);
    return 'created';
  }

  /**
   * `Product.qty` is stock-ledger-derived (see backend/README.md's "Atomic
   * stock ledger" note) — an import must never overwrite it directly the
   * way legacy's `sheet.getRange(...).setValue(qty)` did. Instead, any qty
   * difference an import row implies is posted as a real `ADJUST` stock
   * movement through `StockService.applyMovement`, exactly like every other
   * quantity change in this system, so `WarehouseStock`/`StockMovement`
   * stay consistent and the change shows up in stock history, not just as
   * a silent column overwrite.
   */
  private async applyImportedQty(
    user: RequestUser,
    productId: string,
    importedQty: number | undefined,
    currentQty: number,
    defaultWarehouseId: string | null,
  ) {
    if (importedQty === undefined) return;
    const delta = importedQty - currentQty;
    if (delta === 0) return;
    if (!defaultWarehouseId) {
      throw new Error(
        `Row specifies a quantity but the company has no default warehouse configured — cannot post the ${delta > 0 ? 'increase' : 'decrease'}.`,
      );
    }
    await this.stockService.applyMovement(user, {
      productId,
      warehouseId: defaultWarehouseId,
      type: 'ADJUST',
      qtyDelta: delta,
      comment: 'Excel import',
      sourceType: 'ProductImport',
    });
  }

  /**
   * Export: price columns (5 of them) are stripped for any role lacking
   * `reports:valuation` — a real gap fix, not just a port. `ProductsService`
   * itself has no price-visibility restriction at all (any `products:read`
   * role, including the seeded Viewer, currently gets full pricing from
   * `GET /products`) — this mirrors the legacy `user.role === 'admin'`
   * check from `ImportExport.gs#exportProducts` at the ONE point that check
   * was actually ported anywhere in this backend before now (the AI
   * `SearchProductsTool`, see permission-set.util.ts's header comment for
   * the shared helper this reuses), applying the same rule to the REST
   * export path rather than leaving the wider `ProductsController` gap for
   * a separate decision.
   */
  async exportProducts(user: RequestUser): Promise<Buffer> {
    const permissions = await loadPermissionSet(this.prisma, user);
    const canSeePrices = permissions.has('reports:valuation');

    const [products, units] = await Promise.all([
      this.prisma.tenant.product.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.tenant.companyUnit.findMany(),
    ]);
    const unitNameById = new Map<string, string>(units.map((u: any) => [u.id, u.name]));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow([...EXPORT_HEADERS]);
    sheet.getRow(1).font = { bold: true };

    for (const p of products as any[]) {
      const qty = Number(p.qty) || 0;
      const unitsPerPackage = Number(p.unitsPerPackage) || 0;
      const weightPerUnit = Number(p.weightPerUnitKg) || 0;

      sheet.addRow([
        p.code, p.article, p.name, p.description,
        p.category, p.productGroup, p.family, p.type, p.kind, p.productLine, p.barcode,
        unitNameById.get(p.unitId) ?? '', unitsPerPackage || '', p.cell, qty,
        unitsPerPackage > 0 ? Math.round((qty / unitsPerPackage) * 100) / 100 : '',
        Number(p.minQty) || 0,
        canSeePrices ? this.decimalOrBlank(p.localPriceExclVat) : '',
        canSeePrices ? this.decimalOrBlank(p.localPriceInclVat) : '',
        canSeePrices ? this.decimalOrBlank(p.germanPriceExclVat) : '',
        canSeePrices ? this.decimalOrBlank(p.germanPriceInclVat) : '',
        canSeePrices ? this.decimalOrBlank(p.sellPriceEur) : '',
        weightPerUnit || '', weightPerUnit > 0 ? Math.round(weightPerUnit * qty * 100) / 100 : '',
        p.warrantyMonths, p.status,
        p.manufacturer, p.manufacturerCode, p.countryOfOrigin,
        p.priceListRef, p.note,
        '', // Photo URL — never populated; see this file's header comment (Product has no photo column, photos are FileAsset attachments)
      ]);
    }

    sheet.columns.forEach((col) => { col.width = 18; });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'product.exported',
      entityType: 'Product',
      entityId: user.companyId,
      after: { count: products.length, pricesIncluded: canSeePrices },
    });

    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  private decimalOrBlank(value: unknown): number | string {
    if (value === null || value === undefined) return '';
    return Number(value);
  }

  private cellToPlainValue(value: ExcelJS.CellValue): string | number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') {
      // Rich text / hyperlink / formula-result cells — take the best plain-text approximation.
      if ('text' in (value as any)) return String((value as any).text);
      if ('result' in (value as any)) return (value as any).result ?? null;
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }
    return value as string | number;
  }
}
