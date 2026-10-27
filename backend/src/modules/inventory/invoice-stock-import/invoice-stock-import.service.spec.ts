import { PDFParse } from 'pdf-parse';
import { InvoiceStockImportService } from './invoice-stock-import.service';

jest.mock('pdf-parse', () => ({ PDFParse: jest.fn() }));

function mockPdfText(pagesText: string[]) {
  (PDFParse as unknown as jest.Mock).mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ pages: pagesText.map((text) => ({ text })) }),
    destroy: jest.fn(),
  }));
}

describe('InvoiceStockImportService', () => {
  let service: InvoiceStockImportService;
  let prisma: any;
  let stock: any;
  let ai: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'admin@b.com', roleId: 'r1' };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      tenant: {
        product: {
          findMany: jest.fn().mockResolvedValue([{ id: 'p1', article: 'ABC123', name: 'Профіль VBG' }]),
        },
      },
    };
    stock = { applyMovement: jest.fn().mockResolvedValue({ id: 'm1' }) };
    ai = { recognizeInvoice: jest.fn() };
    audit = { record: jest.fn() };
    service = new InvoiceStockImportService(prisma, stock, ai, audit);
  });

  describe('preview — fast parser', () => {
    it('matches a known article token and extracts qty next to a unit word', async () => {
      mockPdfText(['1  ABC123  5 шт  12.50 EUR']);

      const result = await service.preview(user, Buffer.from('pdf'), 'invoice.pdf', 'application/pdf');

      expect(result.method).toBe('fast');
      expect(result.unmatched).toEqual([]);
      expect(result.matched).toEqual([
        expect.objectContaining({ productId: 'p1', article: 'ABC123', productName: 'Профіль VBG', qty: 5 }),
      ]);
      expect(ai.recognizeInvoice).not.toHaveBeenCalled();
    });

    it('sums qty across repeated mentions of the same article', async () => {
      mockPdfText(['1 ABC123 2 шт', '2 ABC123 3 шт']);

      const result = await service.preview(user, Buffer.from('pdf'), 'invoice.pdf', 'application/pdf');

      expect(result.matched).toEqual([expect.objectContaining({ productId: 'p1', qty: 5 })]);
    });

    it('defaults qty to 1 when no number can be found near the article', async () => {
      mockPdfText(['Позиція ABC123 без кількості']);

      const result = await service.preview(user, Buffer.from('pdf'), 'invoice.pdf', 'application/pdf');

      expect(result.matched).toEqual([expect.objectContaining({ productId: 'p1', qty: 1 })]);
    });
  });

  describe('preview — AI fallback', () => {
    it('falls back to AiService.recognizeInvoice when no known article is found, splitting matched/unmatched', async () => {
      mockPdfText(['Якийсь текст без жодного відомого артикулу']);
      ai.recognizeInvoice.mockResolvedValue([
        { rawName: 'Профіль VBG', qty: 4, matched: true, article: 'ABC123', matchedName: 'Профіль VBG', productId: 'p1' },
        { rawName: 'Невідомий товар', qty: 2, matched: false, article: '', matchedName: '', productId: '' },
      ]);

      const result = await service.preview(user, Buffer.from('pdf'), 'invoice.pdf', 'application/pdf');

      expect(result.method).toBe('ai');
      expect(ai.recognizeInvoice).toHaveBeenCalledWith(user, Buffer.from('pdf').toString('base64'), 'application/pdf');
      expect(result.matched).toEqual([{ productId: 'p1', article: 'ABC123', productName: 'Профіль VBG', qty: 4, rawText: 'Профіль VBG' }]);
      expect(result.unmatched).toEqual([{ rawName: 'Невідомий товар', qty: 2 }]);
    });

    it('falls back to AI when the PDF has no text layer at all (empty pages)', async () => {
      mockPdfText(['']);
      ai.recognizeInvoice.mockResolvedValue([]);

      const result = await service.preview(user, Buffer.from('pdf'), 'scan.pdf', 'application/pdf');

      expect(result.method).toBe('ai');
      expect(ai.recognizeInvoice).toHaveBeenCalled();
    });
  });

  describe('preview — unsupported file', () => {
    it('rejects a non-PDF file', async () => {
      await expect(service.preview(user, Buffer.from('x'), 'price-list.xlsx', 'application/vnd.ms-excel')).rejects.toThrow();
    });
  });

  describe('apply', () => {
    it('posts one RECEIVE movement per line with the right warehouse/sourceType, and one summarizing audit record', async () => {
      const result = await service.apply(user, {
        warehouseId: 'w1',
        lines: [
          { productId: 'p1', qty: 5 },
          { productId: 'p2', qty: 2 },
        ],
      });

      expect(result.applied).toBe(2);
      expect(result.errors).toEqual([]);
      expect(stock.applyMovement).toHaveBeenCalledTimes(2);
      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ productId: 'p1', warehouseId: 'w1', type: 'RECEIVE', qtyDelta: 5, sourceType: 'InvoiceImport' }),
      );
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'stock.invoiceImportApplied' }));
    });

    it('skips lines with qty <= 0 without calling applyMovement for them', async () => {
      const result = await service.apply(user, {
        warehouseId: 'w1',
        lines: [
          { productId: 'p1', qty: 0 },
          { productId: 'p2', qty: -1 },
          { productId: 'p3', qty: 3 },
        ],
      });

      expect(result.applied).toBe(1);
      expect(stock.applyMovement).toHaveBeenCalledTimes(1);
      expect(stock.applyMovement).toHaveBeenCalledWith(user, expect.objectContaining({ productId: 'p3' }));
    });

    it('collects per-row errors without aborting the rest of the batch', async () => {
      stock.applyMovement
        .mockResolvedValueOnce({ id: 'm1' })
        .mockRejectedValueOnce(new Error('Product not found'));

      const result = await service.apply(user, {
        warehouseId: 'w1',
        lines: [
          { productId: 'p1', qty: 1 },
          { productId: 'p-deleted', qty: 1 },
        ],
      });

      expect(result.applied).toBe(1);
      expect(result.errors).toEqual([{ productId: 'p-deleted', message: 'Product not found' }]);
    });
  });
});
