import { Injectable, Logger } from '@nestjs/common';
import { CodedConflictException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PdfRenderTimeoutError, renderHtmlToPdf } from '../../common/pdf/html-to-pdf';
import { FilesService } from '../files/files.service';

export interface PurchaseOrderPdfRenderInput {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  html: string;
}

const PDF_RENDER_TIMEOUT_MS = Number(process.env.PURCHASE_ORDER_PDF_TIMEOUT_MS ?? 30_000);

/**
 * The PurchaseOrder counterpart to PurchaseRequestPdfService — same
 * shared `renderHtmlToPdf`/`pdfRenderQueue` (common/pdf/html-to-pdf.ts)
 * every other PDF-rendering caller in this codebase goes through.
 * Deliberately simpler than PurchaseRequestPdfService: PurchaseOrderItem
 * has no attachedFileIds (that's a заявка-only feature, product documents
 * merge), so there's no pdf-lib attachment-merge step here — HTML straight
 * to FileAsset.
 */
@Injectable()
export class PurchaseOrderPdfService {
  private readonly logger = new Logger(PurchaseOrderPdfService.name);

  constructor(private readonly filesService: FilesService) {}

  async generateAndStore(user: RequestUser, input: PurchaseOrderPdfRenderInput): Promise<string> {
    const pdfBytes = await this.renderOrThrow(input.html);

    const { fileAssetId } = await this.filesService.storeGeneratedAsset({
      companyId: user.companyId,
      actorUserId: user.userId,
      domain: 'PURCHASE_ORDER_DOCUMENT',
      entityType: 'PurchaseOrder',
      entityId: input.purchaseOrderId,
      originalName: `${input.purchaseOrderNumber}.pdf`,
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    });

    return fileAssetId;
  }

  private async renderOrThrow(html: string): Promise<Buffer> {
    try {
      return await renderHtmlToPdf(html, PDF_RENDER_TIMEOUT_MS);
    } catch (err) {
      this.logger.error(`Purchase order PDF render failed: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof PdfRenderTimeoutError) throw new CodedConflictException('PURCHASE_ORDER_PDF_TIMEOUT', err.message);
      throw new CodedConflictException('PURCHASE_ORDER_PDF_RENDER_FAILED', 'Failed to render the purchase order PDF.');
    }
  }
}
