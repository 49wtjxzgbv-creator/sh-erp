import { Injectable } from '@nestjs/common';
import { PDFDocument, type PDFPage, type PDFImage } from 'pdf-lib';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { renderHtmlToPdf } from '../../common/pdf/html-to-pdf';
import { FilesService } from '../files/files.service';

export interface SupplierRequestDocumentItem {
  fileAssetId: string;
  heading: string;
}

const MM_TO_PT = 2.834645669;
const PAGE_MARGIN_TOP_MM = 16;
const PAGE_MARGIN_SIDE_MM = 14;
const PAGE_MARGIN_BOTTOM_MM = 16;
const HEADING_BLOCK_HEIGHT_MM = 40;

/**
 * "Вкладені документи" merged PDF (2026-09-23 user request, revised same
 * day — the original client-side approach embedded each attached PDF into
 * the print DOM via `<iframe>` and relied on `window.print()`, which
 * rasterized it into a blurry bitmap instead of inserting the real file:
 * "погано виглядає ... якщо у форматі пдф то просто вставляй цей пдф
 * файл"). Builds one real PDF instead: Playwright/Chromium renders only the
 * per-attachment heading text (full Unicode/Cyrillic support, unlike
 * pdf-lib's built-in standard fonts, which can't encode Cyrillic at all),
 * then pdf-lib merges each attachment's own untouched PDF pages right after
 * its heading page — never rasterized, so PDF content stays vector-crisp.
 * An image attachment (a photographed drawing, say) is instead drawn
 * directly onto its heading page below the heading text, since there's no
 * "real pages" to preserve for an image the way there is for a PDF.
 */
@Injectable()
export class SupplierRequestDocumentsPdfService {
  constructor(private readonly filesService: FilesService) {}

  async generate(user: RequestUser, items: SupplierRequestDocumentItem[]): Promise<Buffer> {
    const headingsPdfBytes = await renderHtmlToPdf(buildHeadingsHtml(items.map((item) => item.heading)));
    const headingsDoc = await PDFDocument.load(headingsPdfBytes);

    const merged = await PDFDocument.create();
    let includedAny = false;

    for (let i = 0; i < items.length; i++) {
      const { bytes, mimeType } = await this.filesService.getFileAssetBytes(user, items[i].fileAssetId);
      const isPdf = mimeType === 'application/pdf';
      const isPng = mimeType === 'image/png';
      const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
      // CAD sources (STEP/DXF) and any other type have no printable page rendering — skipped, same as the print view.
      if (!isPdf && !isPng && !isJpeg) continue;

      const [headingPage] = await merged.copyPages(headingsDoc, [i]);
      merged.addPage(headingPage);
      includedAny = true;

      if (isPdf) {
        const source = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(source, source.getPageIndices());
        for (const page of pages) merged.addPage(page);
      } else {
        const image = isPng ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
        drawImageBelowHeading(headingPage, image);
      }
    }

    if (!includedAny) {
      throw new CodedBadRequestException('NO_PRINTABLE_DOCUMENTS', 'None of the selected attachments can be printed (only PDF and image files are supported).');
    }

    return Buffer.from(await merged.save());
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
