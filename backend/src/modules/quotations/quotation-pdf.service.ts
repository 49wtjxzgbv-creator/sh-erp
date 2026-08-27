import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';
import { CodedConflictException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';
import { pdfRenderQueue } from './pdf-render-queue';

export interface QuotationPdfRenderInput {
  quotationId: string;
  quotationVersionId: string;
  quotationNumber: string;
  html: string;
}

// §7/§19 of the final confirmation: "жорсткий timeout на рендер PDF; SENT
// не повинен комітитись при помилці/timeout". Chromium rendering a static,
// image-light document is normally a sub-second operation — this bound
// exists to guarantee `send()` can never hang indefinitely on a wedged
// browser process on the 1-CPU VPS, not because real renders are expected
// to approach it.
const PDF_RENDER_TIMEOUT_MS = Number(process.env.QUOTATION_PDF_TIMEOUT_MS ?? 30_000);

/**
 * Real, Playwright-backed renderer — replaces the earlier placeholder that
 * unconditionally threw. Every render goes through `pdfRenderQueue` (§19:
 * "строго через global queue/mutex — максимум один PDF render одночасно")
 * — this method never launches a second Chromium instance concurrently
 * with another call to itself, company or request notwithstanding.
 *
 * Deliberately NOT Docker-isolated for this MVP (explicit scope limit,
 * §19) — a single system Chromium install, launched and torn down per
 * render. `send()` (QuotationsService) still fetches the underlying data
 * and calls QuotationRendererService to build `html` before handing it
 * here — this service's only job is HTML → PDF bytes → FileAsset.
 */
@Injectable()
export class QuotationPdfService {
  private readonly logger = new Logger(QuotationPdfService.name);

  constructor(private readonly filesService: FilesService) {}

  async generateAndStore(user: RequestUser, input: QuotationPdfRenderInput): Promise<string> {
    const pdfBytes = await pdfRenderQueue.run(() => this.renderWithTimeout(input.html));

    const { fileAssetId } = await this.filesService.storeGeneratedAsset({
      companyId: user.companyId,
      actorUserId: user.userId,
      domain: 'QUOTATION_DOCUMENT',
      entityType: 'QuotationVersion',
      entityId: input.quotationVersionId,
      originalName: `${input.quotationNumber}.pdf`,
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    });

    return fileAssetId;
  }

  /**
   * Launch → render → close, always, on both the happy path and every
   * failure/timeout branch (`finally`) — a leaked Chromium process is
   * exactly what the single-render mutex in pdf-render-queue.ts can't
   * protect against once it's already escaped this method's view. The
   * timeout races against the render rather than being passed into
   * Playwright's own per-call `timeout` options, because `page.pdf()`
   * itself has no such option — only navigation/action calls do.
   */
  private async renderWithTimeout(html: string): Promise<Buffer> {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      return await withTimeout(this.renderPdf(browser, html), PDF_RENDER_TIMEOUT_MS);
    } catch (err) {
      this.logger.error(`Quotation PDF render failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err instanceof CodedConflictException ? err : new CodedConflictException('QUOTATION_PDF_RENDER_FAILED', 'Failed to render the quotation PDF.');
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private async renderPdf(browser: import('playwright').Browser, html: string): Promise<Buffer> {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    return pdf;
  }
}

/** Races `promise` against a timer; if the timer wins, attaches a no-op catch to the still-pending `promise` so its eventual rejection (once the caller closes the browser out from under it) never surfaces as an unhandled rejection. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      promise.catch(() => undefined);
      reject(new CodedConflictException('QUOTATION_PDF_TIMEOUT', `PDF rendering exceeded ${ms}ms.`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
