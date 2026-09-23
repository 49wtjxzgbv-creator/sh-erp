jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));

import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { SupplierRequestDocumentsPdfService } from './supplier-request-documents-pdf.service';

const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

// Smallest possible valid 1x1 transparent PNG — a standard test fixture, not hand-authored bytes.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function makeMultiPagePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595.28, 841.89]);
  return Buffer.from(await doc.save());
}

function makeFakePage(pdfBuffer: Buffer) {
  return { setContent: jest.fn().mockResolvedValue(undefined), pdf: jest.fn().mockResolvedValue(pdfBuffer) };
}
function makeFakeBrowser(page: ReturnType<typeof makeFakePage>) {
  return { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue(undefined) };
}

describe('SupplierRequestDocumentsPdfService', () => {
  let files: { getFileAssetBytes: jest.Mock };
  let service: SupplierRequestDocumentsPdfService;

  beforeEach(() => {
    files = { getFileAssetBytes: jest.fn() };
    service = new SupplierRequestDocumentsPdfService(files as any);
    (chromium.launch as jest.Mock).mockReset();
  });

  it("merges an attached PDF's real pages right after its heading page", async () => {
    (chromium.launch as jest.Mock).mockResolvedValue(makeFakeBrowser(makeFakePage(await makeMultiPagePdf(1))));
    files.getFileAssetBytes.mockResolvedValue({ bytes: await makeMultiPagePdf(3), mimeType: 'application/pdf', originalName: 'drawing.pdf' });

    const result = await service.generate(user as any, [{ fileAssetId: 'f1', heading: 'ART-1 — Кронштейн' }]);

    const merged = await PDFDocument.load(result);
    expect(merged.getPageCount()).toBe(4); // 1 heading page + the attachment's own 3 real pages
  });

  it('draws an image attachment directly onto its heading page instead of adding a separate page', async () => {
    (chromium.launch as jest.Mock).mockResolvedValue(makeFakeBrowser(makeFakePage(await makeMultiPagePdf(1))));
    files.getFileAssetBytes.mockResolvedValue({ bytes: PNG_1PX, mimeType: 'image/png', originalName: 'photo.png' });

    const result = await service.generate(user as any, [{ fileAssetId: 'f1', heading: 'ART-2 — Ролик' }]);

    const merged = await PDFDocument.load(result);
    expect(merged.getPageCount()).toBe(1);
  });

  it('gives each of several attachments its own heading page, in order', async () => {
    (chromium.launch as jest.Mock).mockResolvedValue(makeFakeBrowser(makeFakePage(await makeMultiPagePdf(2))));
    files.getFileAssetBytes
      .mockResolvedValueOnce({ bytes: await makeMultiPagePdf(1), mimeType: 'application/pdf', originalName: 'a.pdf' })
      .mockResolvedValueOnce({ bytes: PNG_1PX, mimeType: 'image/png', originalName: 'b.png' });

    const result = await service.generate(user as any, [
      { fileAssetId: 'f1', heading: 'ART-1 — A' },
      { fileAssetId: 'f2', heading: 'ART-2 — B' },
    ]);

    const merged = await PDFDocument.load(result);
    expect(merged.getPageCount()).toBe(3); // (heading + 1 real page) for the PDF, (heading-with-image) for the PNG
  });

  it('skips unsupported attachment types (e.g. CAD) without spending a heading page on them', async () => {
    (chromium.launch as jest.Mock).mockResolvedValue(makeFakeBrowser(makeFakePage(await makeMultiPagePdf(2))));
    files.getFileAssetBytes
      .mockResolvedValueOnce({ bytes: Buffer.from('step-data'), mimeType: 'application/step', originalName: 'part.step' })
      .mockResolvedValueOnce({ bytes: await makeMultiPagePdf(1), mimeType: 'application/pdf', originalName: 'a.pdf' });

    const result = await service.generate(user as any, [
      { fileAssetId: 'f1', heading: 'ART-1 — CAD part' },
      { fileAssetId: 'f2', heading: 'ART-2 — Real doc' },
    ]);

    const merged = await PDFDocument.load(result);
    expect(merged.getPageCount()).toBe(2); // only the PDF item's own heading + its 1 real page
  });

  it('throws a coded error when nothing ends up printable', async () => {
    (chromium.launch as jest.Mock).mockResolvedValue(makeFakeBrowser(makeFakePage(await makeMultiPagePdf(1))));
    files.getFileAssetBytes.mockResolvedValue({ bytes: Buffer.from('step-data'), mimeType: 'application/step', originalName: 'part.step' });

    await expect(service.generate(user as any, [{ fileAssetId: 'f1', heading: 'ART-1 — CAD only' }])).rejects.toThrow();
  });
});
