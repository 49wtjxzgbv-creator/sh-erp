jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));

import { chromium } from 'playwright';
import { ExportToExcelTool, ExportToPdfTool } from './export.tools';

const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };
const context = { user, permissions: new Set<string>() };

function makeFakePage(overrides: Partial<{ setContent: jest.Mock; pdf: jest.Mock }> = {}) {
  return {
    setContent: overrides.setContent ?? jest.fn().mockResolvedValue(undefined),
    pdf: overrides.pdf ?? jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  };
}

function makeFakeBrowser(page: ReturnType<typeof makeFakePage>) {
  return { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue(undefined) };
}

describe('ExportToExcelTool', () => {
  it('produces a CSV file, unaffected by the PDF-rendering follow-up', async () => {
    const filesService = { uploadEphemeralExport: jest.fn().mockResolvedValue({ downloadUrl: 'https://example.com/x.csv' }) };
    const tool = new ExportToExcelTool(filesService as any);

    const result = await tool.execute({ title: 'Звіт', headers: ['a', 'b'], rows: [['1', '2']] }, context);

    expect(result.fileUrl).toBe('https://example.com/x.csv');
    const call = filesService.uploadEphemeralExport.mock.calls[0][1];
    expect(call.filename).toBe('Звіт.csv');
    expect(call.mimeType).toBe('text/csv');
  });
});

describe('ExportToPdfTool (2026-09-06 follow-up: real PDF instead of a .txt placeholder)', () => {
  let filesService: { uploadEphemeralExport: jest.Mock };
  let tool: ExportToPdfTool;

  beforeEach(() => {
    filesService = { uploadEphemeralExport: jest.fn().mockResolvedValue({ downloadUrl: 'https://example.com/doc.pdf' }) };
    tool = new ExportToPdfTool(filesService as any);
    (chromium.launch as jest.Mock).mockReset();
  });

  it('renders a real PDF via the shared Chromium renderer and uploads it as application/pdf', async () => {
    const page = makeFakePage();
    const browser = makeFakeBrowser(page);
    (chromium.launch as jest.Mock).mockResolvedValue(browser);

    const result = await tool.execute({ title: 'Звіт по складу', bodyText: 'Залишків достатньо.' }, context);

    expect(result).toEqual({ fileUrl: 'https://example.com/doc.pdf', message: 'PDF-документ створено' });
    expect(page.setContent).toHaveBeenCalledWith(expect.stringContaining('Звіт по складу'), expect.objectContaining({ waitUntil: 'load' }));
    expect(page.setContent).toHaveBeenCalledWith(expect.stringContaining('Залишків достатньо.'), expect.anything());
    const uploadCall = filesService.uploadEphemeralExport.mock.calls[0][1];
    expect(uploadCall.filename).toBe('Звіт по складу.pdf');
    expect(uploadCall.mimeType).toBe('application/pdf');
    expect(uploadCall.body).toEqual(Buffer.from('%PDF-fake'));
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('escapes HTML-significant characters in the title/body — a prompt-injected <script> cannot reach the rendered page', async () => {
    const page = makeFakePage();
    (chromium.launch as jest.Mock).mockResolvedValue(makeFakeBrowser(page));

    await tool.execute({ title: 'Звіт', bodyText: '<script>alert(1)</script>' }, context);

    const html = page.setContent.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to a plain-text file with the same content when PDF rendering fails, rather than erroring out entirely', async () => {
    (chromium.launch as jest.Mock).mockRejectedValue(new Error('no chromium binary'));

    const result = await tool.execute({ title: 'Звіт', bodyText: 'Текст звіту' }, context);

    expect(result.fileUrl).toBe('https://example.com/doc.pdf');
    expect(result.message).toContain('текстовий файл');
    const uploadCall = filesService.uploadEphemeralExport.mock.calls[0][1];
    expect(uploadCall.filename).toBe('Звіт.txt');
    expect(uploadCall.mimeType).toBe('text/plain');
    expect(uploadCall.body.toString('utf-8')).toContain('Текст звіту');
  });
});
