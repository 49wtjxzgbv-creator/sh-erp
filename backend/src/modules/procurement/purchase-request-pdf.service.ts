import { Injectable, Logger } from '@nestjs/common';
import { CodedConflictException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PdfRenderTimeoutError, renderHtmlToPdf } from '../../common/pdf/html-to-pdf';
import { FilesService } from '../files/files.service';

export interface PurchaseRequestPdfRenderInput {
  purchaseRequestId: string;
  purchaseRequestNumber: string;
  html: string;
}

// Same rationale as QuotationPdfService's own timeout constant — Chromium
// rendering a static, image-light document is normally sub-second; this
// bound guarantees generatePdf() can never hang indefinitely on the
// 1-CPU VPS, not because real renders are expected to approach it.
const PDF_RENDER_TIMEOUT_MS = Number(process.env.PURCHASE_REQUEST_PDF_TIMEOUT_MS ?? 30_000);

/**
 * The PurchaseRequest counterpart to QuotationPdfService — HTML -> PDF
 * bytes -> FileAsset, same shared `renderHtmlToPdf`/`pdfRenderQueue`
 * (common/pdf/html-to-pdf.ts) every other PDF-rendering caller in this
 * codebase goes through, so renders across modules are still serialized
 * one-at-a-time on the single-CPU VPS.
 */
@Injectable()
export class PurchaseRequestPdfService {
  private readonly logger = new Logger(PurchaseRequestPdfService.name);

  constructor(private readonly filesService: FilesService) {}

  async generateAndStore(user: RequestUser, input: PurchaseRequestPdfRenderInput): Promise<string> {
    const pdfBytes = await this.renderOrThrow(input.html);

    const { fileAssetId } = await this.filesService.storeGeneratedAsset({
      companyId: user.companyId,
      actorUserId: user.userId,
      domain: 'PURCHASE_REQUEST_DOCUMENT',
      entityType: 'PurchaseRequest',
      entityId: input.purchaseRequestId,
      originalName: `${input.purchaseRequestNumber}.pdf`,
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    });

    return fileAssetId;
  }

  private async renderOrThrow(html: string): Promise<Buffer> {
    try {
      return await renderHtmlToPdf(html, PDF_RENDER_TIMEOUT_MS);
    } catch (err) {
      this.logger.error(`Purchase request PDF render failed: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof PdfRenderTimeoutError) throw new CodedConflictException('PURCHASE_REQUEST_PDF_TIMEOUT', err.message);
      throw new CodedConflictException('PURCHASE_REQUEST_PDF_RENDER_FAILED', 'Failed to render the purchase request PDF.');
    }
  }
}
