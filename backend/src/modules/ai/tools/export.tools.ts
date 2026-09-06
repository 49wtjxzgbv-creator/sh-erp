import { Injectable, Logger } from '@nestjs/common';
import { renderHtmlToPdf } from '../../../common/pdf/html-to-pdf';
import { FilesService } from '../../files/files.service';
import { AiTool, AiToolContext } from './ai-tool.interface';

/**
 * Ported from AI_TOOLS_.exportToExcel. The legacy version created a real
 * Google Sheets file via `SpreadsheetApp.create`; there is no Drive
 * equivalent here, and pulling in a full `.xlsx`-writing dependency
 * (e.g. `exceljs`) is more than this tool needs. This produces a CSV file
 * instead — Excel/Sheets/Numbers all open `.csv` natively, so the actual
 * user-facing capability ("give me the data as a file I can open in a
 * spreadsheet app") is fully preserved; only the exact container format
 * changed. Disclosed here and in the backend README rather than silently
 * assumed.
 */
@Injectable()
export class ExportToExcelTool implements AiTool {
  readonly key = 'exportToExcel';
  readonly description = 'Створює файл-таблицю з переданими даними і повертає посилання на нього — використовуй, коли просять "зроби ексель", "вивантаж у таблицю" тощо.';
  readonly parameters = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Назва файлу' },
      headers: { type: 'array', items: { type: 'string' }, description: 'Назви колонок' },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Рядки даних, кожен рядок — масив значень по колонках' },
    },
    required: ['title', 'headers', 'rows'],
  };

  constructor(private readonly filesService: FilesService) {}

  async execute(args: Record<string, any>, context: AiToolContext): Promise<any> {
    const title = String(args.title || 'Звіт SH ERP');
    const headers: string[] = Array.isArray(args.headers) ? args.headers : [];
    const rows: string[][] = Array.isArray(args.rows) ? args.rows : [];

    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const body = Buffer.from('﻿' + csv, 'utf-8'); // BOM so Excel opens Cyrillic content correctly

    const { downloadUrl } = await this.filesService.uploadEphemeralExport(context.user, {
      filename: `${title}.csv`,
      mimeType: 'text/csv',
      body,
    });

    return { fileUrl: downloadUrl, message: 'Файл створено (CSV — відкривається в Excel/Google Таблицях)' };
  }
}

/**
 * Ported from AI_TOOLS_.exportToPdf. The legacy version rendered a real PDF
 * via `DocumentApp`/Drive's `getAs('application/pdf')`. This now does too
 * (2026-09-06 follow-up, user request) — reusing the exact same headless-
 * Chromium renderer the Quotations module already relies on for its own
 * PDF documents (`common/pdf/html-to-pdf.ts`, serialized through the same
 * `pdfRenderQueue` so an AI export and a quotation send() never launch two
 * Chromium processes at once on this 1-vCPU VPS). A render failure/timeout
 * degrades to the same plain-text file this tool used to always produce —
 * still gives the user SOMETHING rather than a hard error for what's a
 * best-effort assistant feature, just discloses the downgrade honestly
 * instead of silently pretending the .txt was the PDF.
 */
@Injectable()
export class ExportToPdfTool implements AiTool {
  private readonly logger = new Logger(ExportToPdfTool.name);

  readonly key = 'exportToPdf';
  readonly description = 'Створює PDF-документ із заголовком і текстом та повертає посилання — використовуй для звітів, листів, підсумків.';
  readonly parameters = {
    type: 'object',
    properties: { title: { type: 'string' }, bodyText: { type: 'string', description: 'Повний текст документа' } },
    required: ['title', 'bodyText'],
  };

  constructor(private readonly filesService: FilesService) {}

  async execute(args: Record<string, any>, context: AiToolContext): Promise<any> {
    const title = String(args.title || 'Документ SH ERP');
    const bodyText = String(args.bodyText || '');

    try {
      const pdfBytes = await renderHtmlToPdf(renderDocumentHtml(title, bodyText));
      const { downloadUrl } = await this.filesService.uploadEphemeralExport(context.user, {
        filename: `${title}.pdf`,
        mimeType: 'application/pdf',
        body: pdfBytes,
      });
      return { fileUrl: downloadUrl, message: 'PDF-документ створено' };
    } catch (err) {
      this.logger.warn(`exportToPdf: PDF render failed, falling back to plain text — ${err instanceof Error ? err.message : String(err)}`);
      const content = `${title}\n${'='.repeat(title.length)}\n\n${bodyText}\n`;
      const { downloadUrl } = await this.filesService.uploadEphemeralExport(context.user, {
        filename: `${title}.txt`,
        mimeType: 'text/plain',
        body: Buffer.from(content, 'utf-8'),
      });
      return { fileUrl: downloadUrl, message: 'Не вдалося згенерувати PDF (тимчасова помилка рендерингу) — натомість створено текстовий файл із тим самим вмістом.' };
    }
  }
}

function renderDocumentHtml(title: string, bodyText: string): string {
  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  body { font-family: Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #222222; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 16pt; border-bottom: 2px solid #6423d0; padding-bottom: 8px; margin-bottom: 18px; }
  .body-text { white-space: pre-wrap; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="body-text">${escapeHtml(bodyText)}</div>
</body>
</html>`;
}

/** The title/body text come from the model's tool-call args — untrusted in the same sense any user-entered text is — so this gets loaded directly into a real Chromium page exactly like quotation-renderer.service.ts's own escapeHtml. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
