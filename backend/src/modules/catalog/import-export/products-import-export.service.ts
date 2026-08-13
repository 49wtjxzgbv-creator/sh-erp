import { Injectable, Logger } from '@nestjs/common';
import { CodedBadRequestException } from '../../../common/api-exceptions';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../../common/decorators/current-user.decorator';
import { loadPermissionSet } from '../../../common/authorization/permission-set.util';
import { AuditService } from '../../audit/audit.service';
import { StockService } from '../../inventory/stock.service';
import { FilesService } from '../../files/files.service';
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

interface RowImage {
  buffer: Buffer;
  extension: string; // 'jpeg' | 'png' | 'gif', per exceljs's own Image type
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
  private readonly logger = new Logger(ProductsImportExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockService: StockService,
    private readonly filesService: FilesService,
  ) {}

  async importProducts(user: RequestUser, fileBuffer: Buffer, updateQuantities = false): Promise<ImportProductsResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as any);
    } catch {
      throw new CodedBadRequestException('IMPORT_NOT_A_WORKBOOK', 'Could not read this file as an .xlsx workbook.');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new CodedBadRequestException('IMPORT_FILE_EMPTY', 'The file is empty (no data rows found).');
    }

    const headerRow = worksheet.getRow(1);
    const rawHeaders: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell) => rawHeaders.push(String(cell.value ?? '').trim()));

    const headerMap = buildHeaderMap(rawHeaders);
    const mappedFields = new Set(Object.values(headerMap));
    if (!mappedFields.has('article') || !mappedFields.has('name')) {
      throw new CodedBadRequestException(
        'IMPORT_MISSING_REQUIRED_COLUMNS',
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

    const imagesByRow = this.extractRowImages(workbook, worksheet);

    // Two passes, not one — a real production incident. `TenantScopeInterceptor`
    // wraps the WHOLE request (see PrismaService#runInTenantTransaction's own
    // comment for the identical class of incident this already happened for
    // once, with legacy-import's Apps Script fetch) in a single 60s Prisma
    // transaction. The original version of this method resolved each row's
    // Google Drive photo link with a sequential, unbounded `fetch()` inside
    // the same loop as the DB write — a moderately sized import with several
    // Drive-linked photos summed well past 60 seconds and the whole import
    // failed with "Transaction already closed." Parsing every row first
    // (cheap, no I/O) lets every Drive lookup that's actually needed run
    // together in parallel next, each individually timeout-bounded — the
    // whole batch costs roughly the slowest single fetch, not their sum —
    // before the sequential DB-write loop (which still has to be sequential:
    // it does real, ordered create/update/stock-movement work) even starts.
    interface ParsedRow {
      rowNumber: number;
      mapped: MappedProductRow;
    }
    const parsedRows: ParsedRow[] = [];
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
      parsedRows.push({ rowNumber, mapped });
    }

    const driveImagesByRow = new Map<number, RowImage>();
    await Promise.all(
      parsedRows
        .filter((r) => !imagesByRow.has(r.rowNumber) && typeof r.mapped.photoUrl === 'string')
        .map(async (r) => {
          const image = await this.resolveDrivePhotoUrl(r.mapped.photoUrl as string);
          if (image) driveImagesByRow.set(r.rowNumber, image);
        }),
    );

    let created = 0;
    let updated = 0;

    for (const { rowNumber, mapped } of parsedRows) {
      try {
        const outcome = await this.importOneRow(
          user,
          mapped,
          unitsByLowerName,
          defaultWarehouse?.id ?? null,
          updateQuantities,
          imagesByRow.get(rowNumber) ?? driveImagesByRow.get(rowNumber),
        );
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
    rowImage: RowImage | undefined,
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

    // Deliberately no `deletedAt: null` filter — `article` is unique per
    // company REGARDLESS of soft-delete (no partial index scoping that
    // constraint to non-deleted rows), so a soft-deleted product with this
    // article is exactly what a fresh `create` would collide with. Matching
    // it here and reviving it (below) is correct anyway: real incident —
    // "delete some products, re-import the same file" reported the delete
    // as if it never happened (`deletedAt` update never came back to
    // `null`), so the products stayed invisible everywhere despite the
    // import claiming to have updated them.
    const existing = await this.prisma.tenant.product.findFirst({ where: { article } });
    const importedQty = row.qty !== undefined ? Number(row.qty) : undefined;

    // Already resolved by `importProducts` before this per-row loop began —
    // either an embedded picture (which wins over a photoUrl column: both
    // are rare together in practice, but an actual picture already sitting
    // in the workbook is a stronger signal than a link that depends on
    // Drive sharing settings still being correct whenever this import
    // runs) or a Drive-fetched one, resolved in that earlier parallel pass.
    const resolvedImage = rowImage;

    if (existing) {
      if (unitId) data.unitId = unitId;
      if (existing.deletedAt) data.deletedAt = null; // revive — see this block's own comment above
      const updated = await this.prisma.tenant.product.update({ where: { id: existing.id }, data });
      if (updateQuantities) await this.applyImportedQty(user, updated.id, importedQty, Number(existing.qty), defaultWarehouseId);
      if (resolvedImage) await this.ingestRowPhoto(user, updated.id, article, resolvedImage);
      return 'updated';
    }

    // Real incident: this used to fall back to whichever CompanyUnit sorts
    // first alphabetically when a brand-new row had no recognized Unit
    // value — which is "кг" (kg) given the seeded defaults' Cyrillic sort
    // order (SEED_UNIT_NAMES's own comment lists them; кг sorts before
    // шт/уп/etc.), so every such row silently got created in kilograms
    // regardless of what it actually was counted in. A guessed-wrong unit
    // is worse than no row at all — this now fails the row with a clear
    // per-row error instead (surfaced in the import result the same way a
    // missing article/name already is), same "no silent fallback" idiom
    // this file's own header comment on `defaultWarehouseId` follows.
    if (!unitId) {
      throw new Error('New product has no recognized unit ("Одиниця виміру"/"Unit") column value — add one to create it.');
    }

    const created = await this.prisma.tenant.product.create({
      data: { ...data, article, name: String(row.name), unitId } as any,
    });
    await this.applyImportedQty(user, created.id, importedQty, 0, defaultWarehouseId);
    if (resolvedImage) await this.ingestRowPhoto(user, created.id, article, resolvedImage);
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
   * Reads every picture embedded in the worksheet (a supplier parts
   * catalog commonly has a photo dropped into/over each product's row,
   * not a text URL or filename column — there is no other way to carry an
   * actual image inside an .xlsx cell) and maps each one to the 1-based
   * worksheet row it's anchored over, matching `importProducts`'s own
   * `rowNumber` loop. `getImages()`'s anchor row is 0-based and can be
   * fractional (an image doesn't have to start exactly at a row
   * boundary) — `Math.floor(...) + 1` converts "0-based, mid-row" to the
   * same 1-based row numbering `worksheet.getRow(n)` uses everywhere else
   * in this file. If a row somehow has more than one image anchored to
   * it, the last one wins (rare in practice — one photo per part row is
   * the actual shape this exists for).
   */
  private extractRowImages(workbook: ExcelJS.Workbook, worksheet: ExcelJS.Worksheet): Map<number, RowImage> {
    const imagesByRow = new Map<number, RowImage>();
    for (const img of worksheet.getImages()) {
      const media = workbook.getImage(Number(img.imageId));
      if (!media?.buffer) continue;
      const rowNumber = Math.floor(img.range.tl.row) + 1;
      imagesByRow.set(rowNumber, { buffer: Buffer.from(media.buffer), extension: media.extension });
    }
    return imagesByRow;
  }

  /**
   * Same `FilesService.ingestPhotoAsset` legacy-import's own photo
   * migration uses for the identical "bytes already in hand, no live
   * upload request" situation — see that method's header comment.
   * `legacyId` is synthesized from the article rather than left absent so
   * re-importing the same catalog file (a real, expected recurring
   * workflow, not a one-off) updates the existing photo in place instead
   * of piling up a fresh duplicate `FileAsset` on every run.
   */
  private async ingestRowPhoto(user: RequestUser, productId: string, article: string, image: RowImage): Promise<void> {
    await this.filesService.ingestPhotoAsset({
      companyId: user.companyId,
      actorUserId: user.userId,
      domain: 'PRODUCT_PHOTO',
      entityType: 'Product',
      entityId: productId,
      legacyId: `excel-import-photo:${article}`,
      originalName: `${article}.${image.extension}`,
      mimeType: `image/${image.extension}`,
      bytes: image.buffer,
    });
  }

  /**
   * A "Фото"/"Photo URL" column commonly holds a Google Drive share link
   * (a supplier catalog pasted from Drive, or an export from this app's
   * own legacy-import photo migration) rather than a directly-fetchable
   * image URL. This backend has no Google Drive API integration anywhere
   * (Drive access for the *legacy* import wizard goes through the
   * customer's own paired Apps Script connector, which has no bearing
   * here — see legacy-import/providers/google-apps-script.provider.ts's
   * own comment on why a Drive link "isn't itself fetchable by the
   * backend" in that context). What IS fetchable, unauthenticated, is any
   * file shared "Anyone with the link" via Drive's public download
   * endpoint — the common case for a supplier just pasting a link into a
   * spreadsheet. A file NOT shared that way, or too large to skip Drive's
   * virus-scan interstitial page, fails here — caught and swallowed
   * (logged, not thrown) so one bad photo link never fails an otherwise-
   * good row over a field that's supplementary to the product data itself.
   */
  private async resolveDrivePhotoUrl(url: string | undefined): Promise<RowImage | undefined> {
    if (!url) return undefined;
    const fileId = extractDriveFileId(url);
    if (!fileId) return undefined;

    try {
      // Individually timeout-bounded — this now runs as part of a parallel
      // batch (see importProducts), but an unbounded fetch could still hang
      // that whole batch (and the request's 60s transaction budget with it)
      // on a single slow/unresponsive Drive URL.
      const response = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return undefined;
      const contentType = response.headers.get('content-type') ?? '';
      const match = contentType.match(/^image\/(jpeg|png|gif)/);
      if (!match) return undefined; // most often Drive's HTML "can't scan for viruses" interstitial instead of the real file
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, extension: match[1] };
    } catch (err) {
      this.logger.warn(`Could not fetch Drive photo ${url}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
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
      // A hyperlink cell's `.hyperlink` (the actual link target) wins over
      // `.text` (just the displayed label) — pasting a Drive link into
      // Excel commonly auto-converts it to exactly this shape, and for a
      // photoUrl column specifically it's the target, not the label, that
      // `resolveDrivePhotoUrl` needs to find a file id in.
      if ('hyperlink' in (value as any)) return String((value as any).hyperlink);
      if ('text' in (value as any)) return String((value as any).text);
      if ('result' in (value as any)) return (value as any).result ?? null;
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }
    return value as string | number;
  }
}

/**
 * Parses a Google Drive share URL (`.../d/<fileId>/view` or
 * `...?id=<fileId>`) into the bare file id `resolveDrivePhotoUrl` needs.
 * A local, deliberately-duplicated copy of legacy-import/transform/
 * index.ts's own `extractDriveFileId` (same regex) rather than an import
 * from that module — legacy-import is a one-time-migration-tool module
 * with its own Drive-access story (the paired Apps Script connector, see
 * `resolveDrivePhotoUrl`'s header comment); this feature's Drive access
 * is a completely different, unauthenticated-public-fetch story, and
 * coupling this module to legacy-import's internals over one small regex
 * would be the wrong kind of code reuse.
 */
function extractDriveFileId(url: string): string | undefined {
  const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (dMatch) return dMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idMatch) return idMatch[1];
  return undefined;
}
