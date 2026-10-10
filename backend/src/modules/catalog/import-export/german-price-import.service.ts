import { Injectable, Logger } from '@nestjs/common';
import { CodedBadRequestException } from '../../../common/api-exceptions';
import * as ExcelJS from 'exceljs';
import { PDFParse } from 'pdf-parse';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';

/** Article -> every distinct unit price seen for it in the uploaded document. A `Set` (not a single number) so a genuinely conflicting price within one document — rather than the same price repeated across many line items, which is the normal case — surfaces as `ambiguous` instead of silently picking one. */
type ArticlePrices = Map<string, Set<number>>;

export interface GermanPriceMatch {
  article: string;
  productId: string;
  productName: string;
  recognizedPrice: number;
  currentPrice: number | null;
  diff: number | null; // recognizedPrice - currentPrice, null only when currentPrice was never set
}

export interface GermanPriceUnmatched {
  article: string;
  recognizedPrice: number;
}

export interface GermanPriceAmbiguous {
  article: string;
  prices: number[]; // sorted, every distinct price found for this article in the document
}

export interface GermanPricePreviewResult {
  matched: GermanPriceMatch[];
  unmatched: GermanPriceUnmatched[];
  ambiguous: GermanPriceAmbiguous[];
}

/**
 * "нам потрібно не оновлювати наші ціни а поруч з нашими писати ці ціни щоб
 * бачити різницю між нашими цінами і чужими" (2026-10-10): recognizes
 * article+unit-price pairs from a supplier's own PDF/Excel document and
 * previews them against the catalog's EXISTING `Product.germanPriceExclVat`
 * field (already used elsewhere for exactly this "what does this sell for
 * in Germany" reference point — see schema.prisma) — never touches
 * `sellPriceEur`/`localPrice*` (our own price/cost) at all. Matching is by
 * EXACT article code (case-insensitive, `Product.article` is `citext`), not
 * fuzzy name matching — confirmed with the user that these documents
 * (Stuertz GmbH purchase orders/invoices) already use this company's own
 * catalog article numbers, not a separate supplier SKU system.
 *
 * Deliberately NOT AI-based: both real sample documents are genuine text-
 * layer PDFs (not scans) with a very consistent, machine-generated table
 * ("Item Article Quantity Unit Unit Price ..." repeated per page) — a
 * direct regex/column parser is free, has zero hallucination risk, and
 * (confirmed against a real 1,660-line/55-page invoice) just works, where
 * an AI vision call would cost tokens per page and risk mis-reading a
 * number on a dense table. This is intentionally narrow to Stuertz's own
 * template shape; a differently-formatted supplier document would need its
 * own parser (or a future AI-based fallback) — not attempted here since no
 * such document exists yet to build/verify it against.
 */
@Injectable()
export class GermanPriceImportService {
  private readonly logger = new Logger(GermanPriceImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async preview(user: RequestUser, fileBuffer: Buffer, originalName: string): Promise<GermanPricePreviewResult> {
    const isPdf = /\.pdf$/i.test(originalName);
    const isXlsx = /\.xlsx$/i.test(originalName);
    if (!isPdf && !isXlsx) {
      throw new CodedBadRequestException('GERMAN_PRICE_IMPORT_UNSUPPORTED_FILE', 'Only .pdf or .xlsx files are supported.');
    }
    const articlePrices = isPdf ? await this.parsePdf(fileBuffer) : await this.parseExcel(fileBuffer);
    if (articlePrices.size === 0) {
      throw new CodedBadRequestException('GERMAN_PRICE_IMPORT_NO_ROWS', 'No article/price rows were recognized in this file.');
    }
    return this.matchAgainstCatalog(articlePrices);
  }

  /**
   * Per-row try/catch, same shape as `ProductsImportExportService#importProducts`'s
   * own row loop — by apply time every row already matched a real product
   * during `preview()`, so a failure here realistically only means that
   * product was deleted in the meantime; one such row shouldn't abort the
   * rest of an otherwise-valid confirmed batch.
   */
  async apply(user: RequestUser, updates: { productId: string; price: number }[]): Promise<{ updated: number; errors: { productId: string; message: string }[] }> {
    let updated = 0;
    const errors: { productId: string; message: string }[] = [];
    for (const { productId, price } of updates) {
      try {
        await this.prisma.tenant.product.update({
          where: { id: productId },
          data: { germanPriceExclVat: price },
        });
        updated++;
      } catch (err) {
        errors.push({ productId, message: err instanceof Error ? err.message : 'Unknown error.' });
      }
    }
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'product.germanPriceImported',
      entityType: 'Product',
      entityId: user.companyId,
      after: { updated, errorCount: errors.length },
    });
    return { updated, errors };
  }

  // Stuertz PDF rows look like "{item} {article} {qty} piece {unitPrice} ..."
  // in BOTH their Purchase Order and Invoice templates (confirmed against
  // real 441639.pdf / INV 223123.pdf — the two templates only diverge in
  // what follows: Net-only vs. Net+Total+VAT% columns, which this regex
  // deliberately never looks past). `pdf-parse`'s `getText()` linearizes
  // each page's text in visual reading order, so this one pattern, applied
  // per page, is enough — no PDF.js-level geometry/table-detection needed.
  private async parsePdf(buffer: Buffer): Promise<ArticlePrices> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const ROW_PATTERN = /^\d+\s+([A-Za-z0-9][\w.]*)\s+[\d,]+\.\d{2}\s+piece\s+([\d,]+\.\d{2})\s/gm;
      const articlePrices: ArticlePrices = new Map();
      for (const page of result.pages) {
        for (const match of page.text.matchAll(ROW_PATTERN)) {
          const article = match[1];
          const unitPrice = Number(match[2].replace(/,/g, ''));
          if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
          if (!articlePrices.has(article)) articlePrices.set(article, new Set());
          articlePrices.get(article)!.add(unitPrice);
        }
      }
      this.logger.log(`Parsed PDF: ${articlePrices.size} distinct article(s) across ${result.pages.length} page(s).`);
      return articlePrices;
    } finally {
      await parser.destroy();
    }
  }

  // Both real sample workbooks use a different header wording AND put the
  // price table on a different sheet layout (one has it starting row 1,
  // the other has a title row first) — so this scans every worksheet,
  // looking in the first 10 rows of each for a header row that has BOTH an
  // article-like and a price-like column, rather than assuming a fixed
  // sheet/row/column position. A worksheet with neither is just skipped
  // (not every sheet in these real files is a price table at all — one
  // sample has 3 sheets, only each with its own small table).
  private async parseExcel(buffer: Buffer): Promise<ArticlePrices> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new CodedBadRequestException('GERMAN_PRICE_IMPORT_NOT_A_WORKBOOK', 'Could not read this file as an .xlsx workbook.');
    }

    const articlePrices: ArticlePrices = new Map();
    for (const worksheet of workbook.worksheets) {
      let headerRow = -1;
      let articleCol = -1;
      let priceCol = -1;
      for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
        let foundArticle = -1;
        let foundPrice = -1;
        worksheet.getRow(r).eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const text = String(cell.value ?? '').trim().toLowerCase();
          if (foundArticle === -1 && ARTICLE_HEADER_PATTERN.test(text)) foundArticle = colNumber;
          if (foundPrice === -1 && PRICE_HEADER_PATTERN.test(text)) foundPrice = colNumber;
        });
        if (foundArticle !== -1 && foundPrice !== -1) {
          headerRow = r;
          articleCol = foundArticle;
          priceCol = foundPrice;
          break;
        }
      }
      if (headerRow === -1) continue;

      for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        const article = normalizeArticleCell(row.getCell(articleCol).value);
        const price = normalizePriceCell(row.getCell(priceCol).value);
        // "price === 0" rows are real in these sheets — a sub-assembly
        // header line (its own weight/cost rolls up from the parts under
        // it, see e.g. '451997'/'451995' in the real "Ager S07" sample) —
        // not an actual quoted price, so skip rather than recognize a free price.
        if (!article || price === null || price <= 0) continue;
        if (!articlePrices.has(article)) articlePrices.set(article, new Set());
        articlePrices.get(article)!.add(price);
      }
    }
    this.logger.log(`Parsed Excel: ${articlePrices.size} distinct article(s) across ${workbook.worksheets.length} sheet(s).`);
    return articlePrices;
  }

  private async matchAgainstCatalog(articlePrices: ArticlePrices): Promise<GermanPricePreviewResult> {
    const ambiguous: GermanPriceAmbiguous[] = [];
    const singlePriceByArticle = new Map<string, number>();
    for (const [article, prices] of articlePrices) {
      if (prices.size > 1) {
        ambiguous.push({ article, prices: [...prices].sort((a, b) => a - b) });
      } else {
        singlePriceByArticle.set(article, [...prices][0]);
      }
    }

    const articles = [...singlePriceByArticle.keys()];
    const products = articles.length
      ? await this.prisma.tenant.product.findMany({ where: { article: { in: articles }, deletedAt: null } })
      : [];
    const productByArticle = new Map(products.map((p) => [p.article.trim().toUpperCase(), p]));

    const matched: GermanPriceMatch[] = [];
    const unmatched: GermanPriceUnmatched[] = [];
    for (const [article, recognizedPrice] of singlePriceByArticle) {
      const product = productByArticle.get(article.trim().toUpperCase());
      if (!product) {
        unmatched.push({ article, recognizedPrice });
        continue;
      }
      const currentPrice = product.germanPriceExclVat !== null ? Number(product.germanPriceExclVat) : null;
      matched.push({
        article,
        productId: product.id,
        productName: product.name,
        recognizedPrice,
        currentPrice,
        diff: currentPrice === null ? null : Number((recognizedPrice - currentPrice).toFixed(2)),
      });
    }

    return { matched, unmatched, ambiguous };
  }
}

const ARTICLE_HEADER_PATTERN = /artikel|article|part\s*no|teile\.?nr|артикул/i;
const PRICE_HEADER_PATTERN = /\bprice\b|ціна/i;

function normalizeArticleCell(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object' && value !== null && 'text' in (value as { text?: unknown })) {
    return String((value as { text: unknown }).text).trim() || null;
  }
  return String(value).trim() || null;
}

function normalizePriceCell(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'result' in (value as { result?: unknown })) {
    const result = (value as { result: unknown }).result;
    return typeof result === 'number' ? result : null;
  }
  if (typeof value === 'string') {
    const n = Number(value.replace(',', '.').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
