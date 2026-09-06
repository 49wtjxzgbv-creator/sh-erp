import { Injectable, Logger } from '@nestjs/common';
import { CodedConflictException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PdfRenderTimeoutError, renderHtmlToPdf } from '../../common/pdf/html-to-pdf';
import { FilesService } from '../files/files.service';

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
    const pdfBytes = await this.renderOrThrow(input.html);

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

  /** Thin wrapper over the shared `renderHtmlToPdf` (common/pdf/html-to-pdf.ts) that maps its generic failure/timeout into this module's own coded errors — the launch/render/timeout/queue mechanics themselves are shared with the AI assistant's exportToPdf tool, not duplicated here. */
  private async renderOrThrow(html: string): Promise<Buffer> {
    try {
      return await renderHtmlToPdf(html, PDF_RENDER_TIMEOUT_MS);
    } catch (err) {
      this.logger.error(`Quotation PDF render failed: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof PdfRenderTimeoutError) throw new CodedConflictException('QUOTATION_PDF_TIMEOUT', err.message);
      throw new CodedConflictException('QUOTATION_PDF_RENDER_FAILED', 'Failed to render the quotation PDF.');
    }
  }
}
