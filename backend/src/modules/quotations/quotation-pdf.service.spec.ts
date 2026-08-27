jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));

import { chromium } from 'playwright';
import { QuotationPdfService } from './quotation-pdf.service';

const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

function makeFakePage(overrides: Partial<{ setContent: jest.Mock; pdf: jest.Mock }> = {}) {
  return {
    setContent: overrides.setContent ?? jest.fn().mockResolvedValue(undefined),
    pdf: overrides.pdf ?? jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  };
}

function makeFakeBrowser(page: ReturnType<typeof makeFakePage>) {
  return { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue(undefined) };
}

describe('QuotationPdfService', () => {
  let files: { getDownloadUrl?: jest.Mock; storeGeneratedAsset: jest.Mock };
  let service: QuotationPdfService;

  beforeEach(() => {
    files = { storeGeneratedAsset: jest.fn().mockResolvedValue({ fileAssetId: 'file-1' }) };
    service = new QuotationPdfService(files as any);
    (chromium.launch as jest.Mock).mockReset();
  });

  it('renders HTML into a PDF buffer and stores it as a QUOTATION_DOCUMENT FileAsset', async () => {
    const page = makeFakePage();
    const browser = makeFakeBrowser(page);
    (chromium.launch as jest.Mock).mockResolvedValue(browser);

    const fileAssetId = await service.generateAndStore(user, {
      quotationId: 'q1',
      quotationVersionId: 'qv1',
      quotationNumber: 'КП-2026-0001',
      html: '<html>hi</html>',
    });

    expect(fileAssetId).toBe('file-1');
    expect(page.setContent).toHaveBeenCalledWith('<html>hi</html>', expect.objectContaining({ waitUntil: 'load' }));
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ printBackground: true }));
    expect(files.storeGeneratedAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        actorUserId: 'u1',
        domain: 'QUOTATION_DOCUMENT',
        entityType: 'QuotationVersion',
        entityId: 'qv1',
        originalName: 'КП-2026-0001.pdf',
        mimeType: 'application/pdf',
      }),
    );
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('closes the browser and rejects with a coded error when rendering throws', async () => {
    const page = makeFakePage({ setContent: jest.fn().mockRejectedValue(new Error('boom')) });
    const browser = makeFakeBrowser(page);
    (chromium.launch as jest.Mock).mockResolvedValue(browser);

    await expect(service.generateAndStore(user, { quotationId: 'q1', quotationVersionId: 'qv1', quotationNumber: 'КП-1', html: '<html/>' })).rejects.toThrow();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(files.storeGeneratedAsset).not.toHaveBeenCalled();
  });

  it('times out and closes the browser rather than hanging forever, when the render never settles', async () => {
    jest.useFakeTimers();
    const neverResolves = new Promise<void>(() => undefined);
    const page = makeFakePage({ setContent: jest.fn().mockReturnValue(neverResolves) });
    const browser = makeFakeBrowser(page);
    (chromium.launch as jest.Mock).mockResolvedValue(browser);

    const promise = service.generateAndStore(user, { quotationId: 'q1', quotationVersionId: 'qv1', quotationNumber: 'КП-1', html: '<html/>' });
    const assertion = expect(promise).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(30_001);
    await assertion;
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(files.storeGeneratedAsset).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('serializes two concurrent renders through the shared queue — never two Chromium launches overlapping', async () => {
    let concurrentLaunches = 0;
    let maxConcurrentLaunches = 0;
    (chromium.launch as jest.Mock).mockImplementation(async () => {
      concurrentLaunches++;
      maxConcurrentLaunches = Math.max(maxConcurrentLaunches, concurrentLaunches);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const page = makeFakePage();
      const browser = makeFakeBrowser(page);
      const originalClose = browser.close;
      browser.close = jest.fn(async () => {
        concurrentLaunches--;
        return originalClose();
      });
      return browser;
    });

    await Promise.all([
      service.generateAndStore(user, { quotationId: 'q1', quotationVersionId: 'qv1', quotationNumber: 'A', html: '<a/>' }),
      service.generateAndStore(user, { quotationId: 'q2', quotationVersionId: 'qv2', quotationNumber: 'B', html: '<b/>' }),
    ]);

    expect(maxConcurrentLaunches).toBe(1);
  });
});
