import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, type PDFPage, type PDFImage } from 'pdf-lib';
import { CodedConflictException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PdfRenderTimeoutError, renderHtmlToPdf } from '../../common/pdf/html-to-pdf';
import { FilesService } from '../files/files.service';

export interface PurchaseOrderPdfAttachment {
  fileAssetId: string;
}

export interface PurchaseOrderPdfRenderInput {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  html: string;
  attachments: PurchaseOrderPdfAttachment[];
}

const PDF_RENDER_TIMEOUT_MS = Number(process.env.PURCHASE_ORDER_PDF_TIMEOUT_MS ?? 30_000);

const MM_TO_PT = 2.834645669;
const PAGE_MARGIN_TOP_MM = 16;
const PAGE_MARGIN_SIDE_MM = 14;
const PAGE_MARGIN_BOTTOM_MM = 16;
const A4_WIDTH_PT = 210 * MM_TO_PT;
const A4_HEIGHT_PT = 297 * MM_TO_PT;

/**
 * The PurchaseOrder counterpart to PurchaseRequestPdfService — same
 * shared `renderHtmlToPdf`/`pdfRenderQueue` (common/pdf/html-to-pdf.ts)
 * every other PDF-rendering caller in this codebase goes through.
 *
 * "в пдф файл чомусь не додає креслення товару" (2026-11-12) — unlike
 * PurchaseRequestItem's attachedFileIds (a заявка-only, user-picked-per-
 * item selection), a PO's attachments are never user-selected: every
 * line's own product drawing is merged in automatically, whenever one
 * exists, the same way SourcingAppService's outreach letter does it.
 * Same page-copy merge technique as PurchaseRequestPdfService (not
 * shared as a common utility — small enough, and each caller's own shape
 * differs — see that file's own header comment for the full rationale).
 */
@Injectable()
export class PurchaseOrderPdfService {
  private readonly logger = new Logger(PurchaseOrderPdfService.name);

  constructor(private readonly filesService: FilesService) {}

  async generateAndStore(user: RequestUser, input: PurchaseOrderPdfRenderInput): Promise<string> {
    const mainPdfBytes = await this.renderOrThrow(input.html);
    const pdfBytes = input.attachments.length > 0 ? await this.mergeAttachments(user, mainPdfBytes, input.attachments) : mainPdfBytes;

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

  private async mergeAttachments(user: RequestUser, mainPdfBytes: Buffer, attachments: PurchaseOrderPdfAttachment[]): Promise<Buffer> {
    const merged = await PDFDocument.create();
    const mainDoc = await PDFDocument.load(mainPdfBytes);
    const mainPages = await merged.copyPages(mainDoc, mainDoc.getPageIndices());
    for (const page of mainPages) merged.addPage(page);

    for (const attachment of attachments) {
      const { bytes, mimeType } = await this.filesService.getFileAssetBytes(user, attachment.fileAssetId);
      const isPdf = mimeType === 'application/pdf';
      const isPng = mimeType === 'image/png';
      const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
      // CAD sources (STEP/DXF) and any other type have no printable page rendering — skipped (same as PurchaseRequestPdfService).
      if (!isPdf && !isPng && !isJpeg) continue;

      if (isPdf) {
        const source = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(source, source.getPageIndices());
        for (const page of pages) merged.addPage(page);
      } else {
        const image = isPng ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
        const page = merged.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
        drawImageCentered(page, image);
      }
    }

    return Buffer.from(await merged.save());
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

function drawImageCentered(page: PDFPage, image: PDFImage): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const areaLeft = PAGE_MARGIN_SIDE_MM * MM_TO_PT;
  const areaRight = pageWidth - PAGE_MARGIN_SIDE_MM * MM_TO_PT;
  const areaTop = pageHeight - PAGE_MARGIN_TOP_MM * MM_TO_PT;
  const areaBottom = PAGE_MARGIN_BOTTOM_MM * MM_TO_PT;
  const areaWidth = areaRight - areaLeft;
  const areaHeight = areaTop - areaBottom;

  const scale = Math.min(areaWidth / image.width, areaHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: areaLeft + (areaWidth - width) / 2,
    y: areaBottom + (areaHeight - height) / 2,
    width,
    height,
  });
}
