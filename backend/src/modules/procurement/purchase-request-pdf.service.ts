import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, type PDFPage, type PDFImage } from 'pdf-lib';
import { CodedConflictException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PdfRenderTimeoutError, renderHtmlToPdf } from '../../common/pdf/html-to-pdf';
import { FilesService } from '../files/files.service';

export interface PurchaseRequestPdfAttachment {
  fileAssetId: string;
  /** e.g. "Поз. 2 — TEST-001 — drawing.pdf" — rendered as this attachment's own heading page, same reason as SupplierRequestDocumentsPdfService's own heading (pdf-lib's built-in standard fonts can't encode Cyrillic, so headings go through Chromium too). */
  heading: string;
}

export interface PurchaseRequestPdfRenderInput {
  purchaseRequestId: string;
  purchaseRequestNumber: string;
  html: string;
  attachments: PurchaseRequestPdfAttachment[];
}

const PDF_RENDER_TIMEOUT_MS = Number(process.env.PURCHASE_REQUEST_PDF_TIMEOUT_MS ?? 30_000);

const MM_TO_PT = 2.834645669;
const PAGE_MARGIN_TOP_MM = 16;
const PAGE_MARGIN_SIDE_MM = 14;
const PAGE_MARGIN_BOTTOM_MM = 16;
const HEADING_BLOCK_HEIGHT_MM = 40;

/**
 * The PurchaseRequest counterpart to QuotationPdfService — HTML -> PDF
 * bytes -> FileAsset, same shared `renderHtmlToPdf`/`pdfRenderQueue`
 * (common/pdf/html-to-pdf.ts) every other PDF-rendering caller in this
 * codebase goes through. Additionally merges in real attachment files
 * (2026-10-21 user request — "додай можливість додавати файли з товарів
 * ... які саме додавати або додавати всі і це окремо до кожної позиції"),
 * same vector-crisp merge technique as
 * sales/supplier-request-documents-pdf.service.ts (not shared as a common
 * utility — small enough, and each caller's heading/attachment shape
 * differs — see that file's own header comment for the full rationale on
 * why a real pdf-lib merge beats rasterizing via <iframe>+window.print()).
 */
@Injectable()
export class PurchaseRequestPdfService {
  private readonly logger = new Logger(PurchaseRequestPdfService.name);

  constructor(private readonly filesService: FilesService) {}

  async generateAndStore(user: RequestUser, input: PurchaseRequestPdfRenderInput): Promise<string> {
    const mainPdfBytes = await this.renderOrThrow(input.html);
    const pdfBytes = input.attachments.length > 0 ? await this.mergeAttachments(user, mainPdfBytes, input.attachments) : mainPdfBytes;

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

  private async mergeAttachments(user: RequestUser, mainPdfBytes: Buffer, attachments: PurchaseRequestPdfAttachment[]): Promise<Buffer> {
    const headingsPdfBytes = await this.renderOrThrow(buildHeadingsHtml(attachments.map((a) => a.heading)));
    const headingsDoc = await PDFDocument.load(headingsPdfBytes);

    const merged = await PDFDocument.create();
    const mainDoc = await PDFDocument.load(mainPdfBytes);
    const mainPages = await merged.copyPages(mainDoc, mainDoc.getPageIndices());
    for (const page of mainPages) merged.addPage(page);

    for (let i = 0; i < attachments.length; i++) {
      const { bytes, mimeType } = await this.filesService.getFileAssetBytes(user, attachments[i].fileAssetId);
      const isPdf = mimeType === 'application/pdf';
      const isPng = mimeType === 'image/png';
      const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
      // CAD sources (STEP/DXF) and any other type have no printable page rendering — skipped (same as SupplierRequestDocumentsPdfService).
      if (!isPdf && !isPng && !isJpeg) continue;

      const [headingPage] = await merged.copyPages(headingsDoc, [i]);
      merged.addPage(headingPage);

      if (isPdf) {
        const source = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(source, source.getPageIndices());
        for (const page of pages) merged.addPage(page);
      } else {
        const image = isPng ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
        drawImageBelowHeading(headingPage, image);
      }
    }

    return Buffer.from(await merged.save());
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

function drawImageBelowHeading(page: PDFPage, image: PDFImage): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const areaLeft = PAGE_MARGIN_SIDE_MM * MM_TO_PT;
  const areaRight = pageWidth - PAGE_MARGIN_SIDE_MM * MM_TO_PT;
  const areaTop = pageHeight - (PAGE_MARGIN_TOP_MM + HEADING_BLOCK_HEIGHT_MM) * MM_TO_PT;
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

function buildHeadingsHtml(headings: string[]): string {
  const sections = headings
    .map((heading) => `<section class="doc-heading-page"><div class="doc-heading"><h1>${escapeHtml(heading)}</h1></div></section>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page { size: A4; margin: ${PAGE_MARGIN_TOP_MM}mm ${PAGE_MARGIN_SIDE_MM}mm ${PAGE_MARGIN_BOTTOM_MM}mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, Montserrat, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #222222; }
    .doc-heading-page { page-break-after: always; }
    .doc-heading-page:last-child { page-break-after: auto; }
    .doc-heading { height: ${HEADING_BLOCK_HEIGHT_MM}mm; display: flex; align-items: flex-start; }
    .doc-heading h1 { margin: 0; font-size: 16pt; font-weight: 700; line-height: 1.3; }
  </style></head><body>${sections || '<section class="doc-heading-page"></section>'}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
