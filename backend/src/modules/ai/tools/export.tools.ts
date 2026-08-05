import { Injectable } from '@nestjs/common';
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
 * via `DocumentApp`/Drive's `getAs('application/pdf')`. Real PDF rendering
 * server-side needs a dedicated dependency (e.g. Puppeteer or PDFKit,
 * neither installed yet) — out of scope for this pass. This produces a
 * plain-text file with the same title + body content instead, so the
 * underlying capability ("write this up and give me a document") still
 * fully works end to end; only the container format is downgraded from
 * `.pdf` to `.txt`, disclosed here and in the README rather than faked.
 */
@Injectable()
export class ExportToPdfTool implements AiTool {
  readonly key = 'exportToPdf';
  readonly description = 'Створює текстовий документ із заголовком і текстом та повертає посилання — використовуй для звітів, листів, підсумків.';
  readonly parameters = {
    type: 'object',
    properties: { title: { type: 'string' }, bodyText: { type: 'string', description: 'Повний текст документа' } },
    required: ['title', 'bodyText'],
  };

  constructor(private readonly filesService: FilesService) {}

  async execute(args: Record<string, any>, context: AiToolContext): Promise<any> {
    const title = String(args.title || 'Документ SH ERP');
    const bodyText = String(args.bodyText || '');
    const content = `${title}\n${'='.repeat(title.length)}\n\n${bodyText}\n`;
    const body = Buffer.from(content, 'utf-8');

    const { downloadUrl } = await this.filesService.uploadEphemeralExport(context.user, {
      filename: `${title}.txt`,
      mimeType: 'text/plain',
      body,
    });

    return { fileUrl: downloadUrl, message: 'Документ створено (текстовий файл — реальний PDF-рендеринг ще не підключено)' };
  }
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
