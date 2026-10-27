import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CodedBadRequestException } from '../../../common/api-exceptions';
import { PDFParse } from 'pdf-parse';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestUser } from '../../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';
import { StockService } from '../stock.service';
import { AiService } from '../../ai/ai.service';

export interface InvoiceImportMatchedRow {
  productId: string;
  article: string;
  productName: string;
  qty: number;
  rawText: string;
}

export interface InvoiceImportUnmatchedRow {
  rawName: string;
  qty: number;
}

export interface InvoiceImportPreviewResult {
  /** Which path produced this preview — surfaced to the user. `unmatched` is always [] for 'fast' (see class header comment). */
  method: 'fast' | 'ai';
  matched: InvoiceImportMatchedRow[];
  unmatched: InvoiceImportUnmatchedRow[];
}

// `\b` is ASCII-only in JS regex (\w excludes Cyrillic), so it silently
// fails to bound "шт"/"од" — a trailing negative lookahead for "another
// letter" works for both alphabets instead.
const NOT_FOLLOWED_BY_LETTER = '(?![a-zA-Zа-яёіїєґ])';
const UNIT_QTY_AFTER = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:шт\\.?|pcs?\\.?|stk\\.?|st\\.?|од\\.?|x|х)${NOT_FOLLOWED_BY_LETTER}`, 'i');
const UNIT_QTY_BEFORE = new RegExp(`(?:шт\\.?|pcs?\\.?|stk\\.?|st\\.?|од\\.?|x|х)${NOT_FOLLOWED_BY_LETTER}\\s*[:.]?\\s*(\\d+(?:[.,]\\d+)?)`, 'i');
const STANDALONE_NUMBER = /\d+(?:[.,]\d+)?/g;

// Latin+digit only (NOT Cyrillic) — this catalog's article codes are Latin
// alphanumeric (same assumption GermanPriceImportService's own regex makes:
// `[A-Za-z0-9][\w.]*`). Deliberately excluding Cyrillic from the boundary
// class means a Cyrillic product name glued directly onto a Latin article
// code (the common real-world case: pdf-parse fuses the Article cell onto
// the neighboring Cyrillic Name cell with zero separator — see tryFastParse's
// own comment) still counts as a valid boundary — only another Latin
// letter/digit immediately touching the article is treated as ambiguous
// and rejected.
const ARTICLE_BOUNDARY_CLASS = 'A-Za-z0-9';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "а якось воно ж без аі розпізнавалось" (2026-10-27): a free, deterministic
 * first pass — tokenize the PDF's extracted text (same `pdf-parse` package
 * as `GermanPriceImportService`) and look up each token against the
 * company's own known `Product.article` codes (hashmap lookup, not a
 * per-supplier regex template, since supplier invoice formats vary here —
 * unlike GermanPriceImportService's single known Stuertz template). Finding
 * zero rows is NOT an error — it's the defined trigger to fall back to
 * `AiService.recognizeInvoice`'s Gemini vision recognition, which handles
 * any format/layout at the cost of an AI call. Either path's result goes
 * through the same preview/confirm UI before anything is written to stock —
 * `apply()` is the only place either path's numbers actually take effect.
 *
 * Quantities are always treated as an ADDITIVE delta ("received N more
 * units", `StockMovementType.RECEIVE`) — never as an absolute target qty.
 * See `ProductsImportExportService#applyImportedQty`'s own header comment
 * for the real incident (stale "Кількість" column silently posting wrong
 * `ADJUST` movements on re-import) this deliberately avoids repeating.
 */
@Injectable()
export class InvoiceStockImportService {
  private readonly logger = new Logger(InvoiceStockImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly aiService: AiService,
    private readonly auditService: AuditService,
  ) {}

  async preview(user: RequestUser, fileBuffer: Buffer, originalName: string, mimeType: string): Promise<InvoiceImportPreviewResult> {
    const isPdf = /\.pdf$/i.test(originalName) || mimeType === 'application/pdf';
    if (!isPdf) {
      throw new CodedBadRequestException('INVOICE_IMPORT_UNSUPPORTED_FILE', 'Only .pdf files are supported.');
    }

    const fastRows = await this.tryFastParse(fileBuffer);
    if (fastRows.length > 0) {
      return { method: 'fast', matched: fastRows, unmatched: [] };
    }

    this.logger.log('Fast parser found no known article codes in this PDF — falling back to AI recognition.');
    return this.aiFallback(user, fileBuffer);
  }

  /**
   * Per-row try/catch, same resilience shape as `GermanPriceImportService.apply` —
   * by apply time every row already resolved to a real product during
   * `preview()`, so a failure here realistically only means that product
   * was deleted in the meantime; one such row shouldn't abort the rest of
   * an otherwise-confirmed batch. All rows in one call share a single
   * `sourceId` so the resulting `StockMovement`s can be correlated later.
   */
  async apply(
    user: RequestUser,
    input: { warehouseId: string; lines: { productId: string; qty: number }[] },
  ): Promise<{ applied: number; errors: { productId: string; message: string }[] }> {
    let applied = 0;
    const errors: { productId: string; message: string }[] = [];
    const batchId = randomUUID();

    for (const { productId, qty } of input.lines) {
      if (!(qty > 0)) continue; // never post a zero/negative "receive" — see class header comment on additive-only semantics
      try {
        await this.stockService.applyMovement(user, {
          productId,
          warehouseId: input.warehouseId,
          type: 'RECEIVE',
          qtyDelta: qty,
          sourceType: 'InvoiceImport',
          sourceId: batchId,
          comment: 'Надходження за накладною (імпорт PDF)',
        });
        applied++;
      } catch (err) {
        errors.push({ productId, message: err instanceof Error ? err.message : 'Unknown error.' });
      }
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'stock.invoiceImportApplied',
      entityType: 'StockMovement',
      entityId: user.companyId,
      after: { applied, errorCount: errors.length, warehouseId: input.warehouseId },
    });

    return { applied, errors };
  }

  private async aiFallback(user: RequestUser, buffer: Buffer): Promise<InvoiceImportPreviewResult> {
    const lines = await this.aiService.recognizeInvoice(user, buffer.toString('base64'), 'application/pdf');
    const matched: InvoiceImportMatchedRow[] = [];
    const unmatched: InvoiceImportUnmatchedRow[] = [];
    for (const line of lines) {
      if (line.matched && line.productId) {
        matched.push({ productId: line.productId, article: line.article, productName: line.matchedName, qty: line.qty, rawText: line.rawName });
      } else {
        unmatched.push({ rawName: line.rawName, qty: line.qty });
      }
    }
    return { method: 'ai', matched, unmatched };
  }

  private async tryFastParse(buffer: Buffer): Promise<InvoiceImportMatchedRow[]> {
    const products = await this.prisma.tenant.product.findMany({
      where: { deletedAt: null },
      select: { id: true, article: true, name: true },
    });
    const articleMap = new Map(products.map((p) => [p.article.trim().toUpperCase(), p]));
    if (articleMap.size === 0) return [];

    let pages: { text: string }[];
    try {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        pages = result.pages;
      } finally {
        await parser.destroy();
      }
    } catch (err) {
      this.logger.warn(`Fast PDF text extraction failed, will fall back to AI: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }

    // Matched as a substring search with alphanumeric-boundary lookaround,
    // NOT a whitespace-split token lookup — `pdf-parse`'s getText() joins
    // two text-showing operators with NO separator whenever their visual
    // gap is below its own ~7pt column-detection threshold (confirmed
    // against its bundled source), which routinely glues an invoice's
    // Article cell straight onto its neighboring Name/Qty cell with zero
    // characters between them. A plain `/\S+/g` token lookup then produces
    // one fused token that can never equal a known article exactly, so
    // fast-parse silently "finds nothing" on any such invoice layout (real
    // incident, 2026-10-27). Scanning for the article as a substring whose
    // neighbors (if any) aren't themselves alphanumeric tolerates that —
    // e.g. "ABC123Назва..." still matches "ABC123" because a Cyrillic
    // letter right after it isn't in the Latin/digit boundary class used
    // for the article side (articles in this catalog are Latin+digits).
    // Longest-first alternation order so one article that's a substring of
    // another longer one doesn't pre-empt the correct, longer match.
    const sortedArticles = [...articleMap.keys()].sort((a, b) => b.length - a.length);
    let articlePattern: RegExp;
    try {
      articlePattern = new RegExp(`(?<![${ARTICLE_BOUNDARY_CLASS}])(${sortedArticles.map(escapeRegExp).join('|')})(?![${ARTICLE_BOUNDARY_CLASS}])`, 'gi');
    } catch (err) {
      this.logger.warn(`Could not build the fast-parse article pattern (catalog too large?), will fall back to AI: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }

    const found = new Map<string, { article: string; productName: string; qty: number; rawText: string }>();
    for (const page of pages) {
      for (const line of page.text.split('\n')) {
        for (const articleMatch of line.matchAll(articlePattern)) {
          const matchedText = articleMatch[0];
          const product = articleMap.get(matchedText.toUpperCase());
          if (!product) continue;

          const matchEnd = (articleMatch.index ?? 0) + matchedText.length;
          const qty = this.extractQty(line, line.slice(matchEnd), matchedText);

          const existing = found.get(product.id);
          if (existing) {
            existing.qty += qty;
          } else {
            found.set(product.id, { article: product.article, productName: product.name, qty, rawText: line.trim().slice(0, 200) });
          }
        }
      }
    }

    return [...found.entries()].map(([productId, row]) => ({ productId, ...row }));
  }

  // Prefer a number adjacent to a unit word (high confidence); else the
  // first standalone number AFTER the matched article token that isn't the
  // article token itself (guards against re-capturing a purely-numeric
  // article as its own quantity); else default to 1 — same fallback the AI
  // prompt itself uses, so both paths behave consistently in the preview UI.
  private extractQty(line: string, afterToken: string, articleToken: string): number {
    const unitMatch = line.match(UNIT_QTY_AFTER) || line.match(UNIT_QTY_BEFORE);
    if (unitMatch) return this.normalizeNumber(unitMatch[1]);

    for (const numberMatch of afterToken.matchAll(STANDALONE_NUMBER)) {
      if (numberMatch[0].toUpperCase() !== articleToken.toUpperCase()) {
        return this.normalizeNumber(numberMatch[0]);
      }
    }
    return 1;
  }

  private normalizeNumber(raw: string): number {
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
}
