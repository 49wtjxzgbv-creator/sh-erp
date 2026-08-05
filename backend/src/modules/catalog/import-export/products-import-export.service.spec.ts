import * as ExcelJS from 'exceljs';
import { ProductsImportExportService } from './products-import-export.service';

async function buildWorkbookBuffer(headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  rows.forEach((r) => sheet.addRow(r));
  return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

describe('ProductsImportExportService', () => {
  let service: ProductsImportExportService;
  let prisma: any;
  let audit: any;
  let stock: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'admin@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh-default' }) },
        companyUnit: {
          findMany: jest.fn().mockResolvedValue([{ id: 'unit-pcs', companyId: 'c1', name: 'шт' }]),
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'unit-new', ...data })),
        },
        product: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p-new', qty: 0, ...data })),
          update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p-existing', qty: 5, ...data })),
          findMany: jest.fn().mockResolvedValue([]),
        },
        role: { findUnique: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    stock = { applyMovement: jest.fn().mockResolvedValue({}) };
    service = new ProductsImportExportService(prisma, audit, stock);
  });

  describe('importProducts', () => {
    it('rejects a file missing both an article and a name column', async () => {
      const buffer = await buildWorkbookBuffer(['Опис'], [['щось']]);
      await expect(service.importProducts(user, buffer)).rejects.toThrow(/Article.*Name/);
    });

    it('creates a new product, auto-creating an unrecognized unit and posting the opening qty through StockService', async () => {
      const buffer = await buildWorkbookBuffer(
        ['Артикул', 'Назва', 'Одиниця', 'Залишок'],
        [['ABC-1', 'Гвинт M6', 'уп', 10]],
      );

      const result = await service.importProducts(user, buffer);

      expect(result.created).toBe(1);
      expect(result.errors).toEqual([]);
      expect(prisma.tenant.companyUnit.create).toHaveBeenCalledWith({ data: { name: 'уп' } });
      expect(prisma.tenant.product.create).toHaveBeenCalled();
      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ productId: 'p-new', qtyDelta: 10, type: 'ADJUST', warehouseId: 'wh-default' }),
      );
    });

    it('reuses an existing unit case-insensitively instead of creating a duplicate', async () => {
      const buffer = await buildWorkbookBuffer(['Артикул', 'Назва', 'Одиниця'], [['ABC-1', 'Гвинт M6', 'ШТ']]);
      await service.importProducts(user, buffer);
      expect(prisma.tenant.companyUnit.create).not.toHaveBeenCalled();
      expect(prisma.tenant.product.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ unitId: 'unit-pcs' }) }),
      );
    });

    it('updates an existing product (matched by article) and posts only the qty DELTA, never overwriting Product.qty directly', async () => {
      prisma.tenant.product.findFirst.mockResolvedValue({ id: 'p-existing', article: 'ABC-1', qty: 5, unitId: 'unit-pcs' });
      const buffer = await buildWorkbookBuffer(['Артикул', 'Назва', 'Залишок'], [['ABC-1', 'Гвинт M6', 12]]);

      const result = await service.importProducts(user, buffer);

      expect(result.updated).toBe(1);
      expect(prisma.tenant.product.update).toHaveBeenCalled();
      // 12 (imported) - 5 (current) = 7, never the raw 12
      expect(stock.applyMovement).toHaveBeenCalledWith(user, expect.objectContaining({ qtyDelta: 7 }));
    });

    it('skips a fully blank row silently (section separator), not as an error', async () => {
      const buffer = await buildWorkbookBuffer(
        ['Артикул', 'Назва'],
        [
          ['ABC-1', 'Гвинт M6'],
          ['', ''],
        ],
      );
      const result = await service.importProducts(user, buffer);
      expect(result.created).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('records a row-level error (not a thrown exception for the whole import) when article or name is missing', async () => {
      const buffer = await buildWorkbookBuffer(
        ['Артикул', 'Назва'],
        [
          ['ABC-1', 'Гвинт M6'],
          ['', 'Без артикулу'],
        ],
      );
      const result = await service.importProducts(user, buffer);
      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toMatch(/Missing article or name/);
    });

    it('records a row-level error, not a whole-import failure, when a qty is given but no default warehouse exists', async () => {
      prisma.tenant.warehouse.findFirst.mockResolvedValue(null);
      const buffer = await buildWorkbookBuffer(['Артикул', 'Назва', 'Залишок'], [['ABC-1', 'Гвинт M6', 10]]);
      const result = await service.importProducts(user, buffer);
      expect(result.created).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toMatch(/default warehouse/);
    });

    it('never sets Product.qty directly on create — only via StockService', async () => {
      const buffer = await buildWorkbookBuffer(['Артикул', 'Назва', 'Залишок'], [['ABC-1', 'Гвинт M6', 10]]);
      await service.importProducts(user, buffer);
      const createCallData = prisma.tenant.product.create.mock.calls[0][0].data;
      expect(createCallData.qty).toBeUndefined();
    });
  });

  describe('exportProducts', () => {
    beforeEach(() => {
      prisma.tenant.product.findMany.mockResolvedValue([
        {
          id: 'p1', article: 'ABC-1', name: 'Гвинт M6', unitId: 'unit-pcs', qty: 10, minQty: 2,
          localPriceExclVat: 1.5, localPriceInclVat: 1.8, germanPriceExclVat: 2, germanPriceInclVat: 2.4,
          sellPriceEur: 3, unitsPerPackage: 100, weightPerUnitKg: 0.01,
        },
      ]);
    });

    it('blanks all 5 price columns when the caller lacks reports:valuation', async () => {
      prisma.tenant.role.findUnique.mockResolvedValue({
        id: 'r1', permissions: [{ permission: { key: 'products:read' } }],
      });

      const buffer = await service.exportProducts(user);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const sheet = workbook.worksheets[0];
      const dataRow = sheet.getRow(2).values as any[];

      // exceljs row.values is 1-indexed (values[0] is unused) — 'Ціна наша без ПДВ (EUR)'
      // is EXPORT_HEADERS[17] (0-indexed), i.e. values[18].
      expect(dataRow[18]).toBeFalsy();
      expect(dataRow[19]).toBeFalsy();
      expect(dataRow[22]).toBeFalsy(); // Ціна продажу (EUR)
    });

    it('includes all 5 price columns when the caller has reports:valuation', async () => {
      prisma.tenant.role.findUnique.mockResolvedValue({
        id: 'r1', permissions: [{ permission: { key: 'reports:valuation' } }],
      });

      const buffer = await service.exportProducts(user);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const sheet = workbook.worksheets[0];
      const dataRow = sheet.getRow(2).values as any[];

      expect(dataRow[18]).toBe(1.5);
      expect(dataRow[22]).toBe(3);
    });

    it('never writes a real Photo URL — Product has no photo column (see header comment)', async () => {
      prisma.tenant.role.findUnique.mockResolvedValue({ id: 'r1', permissions: [] });
      const buffer = await service.exportProducts(user);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const sheet = workbook.worksheets[0];
      const dataRow = sheet.getRow(2).values as any[];
      expect(dataRow[32]).toBeFalsy(); // last column, Фото URL
    });
  });
});
