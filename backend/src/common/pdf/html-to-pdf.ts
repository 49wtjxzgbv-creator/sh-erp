import { chromium } from 'playwright';
import { pdfRenderQueue } from '../../modules/quotations/pdf-render-queue';

export const DEFAULT_PDF_RENDER_TIMEOUT_MS = 30_000;

/** Distinct from a render failure so callers can give a more specific message ("rendering took too long" vs. "rendering broke"). */
export class PdfRenderTimeoutError extends Error {}

/**
 * HTML → PDF via a headless Chromium (Playwright), extracted out of
 * `QuotationPdfService` (2026-09-06) so the AI assistant's `exportToPdf`
 * tool can produce a real PDF too, instead of the plain-.txt placeholder
 * it shipped with — same underlying capability, no reason to duplicate the
 * launch/render/timeout dance for a second caller.
 *
 * Always serialized through the shared `pdfRenderQueue` (§7/§19 of the
 * Quotations PDF spec: "через VPS з 1 CPU Chromium запускати строго через
 * global queue/mutex — максимум один PDF render одночасно") — that
 * constraint is about the box having one vCPU, not about quotations
 * specifically, so it applies equally to every PDF-producing feature in
 * this codebase. Importing the same module-level queue instance quotations
 * already uses (rather than a second one) is what actually keeps the "one
 * Chromium process at a time" guarantee true app-wide.
 */
export async function renderHtmlToPdf(html: string, timeoutMs = DEFAULT_PDF_RENDER_TIMEOUT_MS): Promise<Buffer> {
  return pdfRenderQueue.run(() => renderWithTimeout(html, timeoutMs));
}

async function renderWithTimeout(html: string, timeoutMs: number): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    return await withTimeout(renderPdf(browser, html), timeoutMs);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function renderPdf(browser: import('playwright').Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  return page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
}

/** Races `promise` against a timer; if the timer wins, attaches a no-op catch to the still-pending `promise` so its eventual rejection (once the caller closes the browser out from under it) never surfaces as an unhandled rejection. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      promise.catch(() => undefined);
      reject(new PdfRenderTimeoutError(`PDF rendering exceeded ${ms}ms.`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
