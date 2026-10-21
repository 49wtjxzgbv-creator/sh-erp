import { Injectable } from '@nestjs/common';
import { PLATFORM_LOGO_DATA_URI } from '../quotations/platform-logo';

export interface PurchaseRequestRenderItem {
  articleSnapshot: string;
  productNameSnapshot: string;
  qty: number;
  expectedPrice: number | null;
}

export interface PurchaseRequestRenderData {
  number: string;
  createdAt: Date;
  companyName: string;
  supplier: { name: string; contactPerson: string | null; phone: string | null; email: string | null };
  comment: string | null;
  items: PurchaseRequestRenderItem[];
}

/**
 * The PurchaseRequest counterpart to QuotationRendererService — same "data
 * → HTML → Chromium" single-code-path shape (see that file's own header
 * comment), deliberately simpler: no templates/branding/visibleBlocks/
 * multi-locale, since this is an internal staff document (one locale —
 * Ukrainian — same reasoning as the rest of this module's uk-only UI
 * copy, not yet translated like Quotations' customer-facing documents).
 * Pure and synchronous — no Prisma, no fetch.
 */
@Injectable()
export class PurchaseRequestRendererService {
  renderHtml(data: PurchaseRequestRenderData): string {
    const money = (v: number | null) => (v !== null ? `${v.toFixed(2)} €` : '—');
    const fmtQty = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
    const fmtDate = (d: Date) => new Date(d).toLocaleDateString('uk-UA');

    const itemRows = data.items
      .map(
        (item, i) => `
        <tr>
          <td class="col-idx">${i + 1}</td>
          <td class="col-article">${escapeHtml(item.articleSnapshot)}</td>
          <td>${escapeHtml(item.productNameSnapshot)}</td>
          <td class="col-num">${fmtQty(item.qty)}</td>
          <td class="col-num">${money(item.expectedPrice)}</td>
        </tr>`,
      )
      .join('');

    return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<title>Заявка на прорахунок ${escapeHtml(data.number)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Inter, Montserrat, 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #222222;
    background: #ffffff;
    font-size: 12px;
    line-height: 1.45;
    margin: 0;
  }
  .header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 2px solid #6423d0; padding-bottom: 10px; margin-bottom: 18px; }
  .header .brand { display: flex; align-items: center; gap: 14px; }
  .header .brand img { max-height: 42px; max-width: 150px; object-fit: contain; }
  .header .doc-meta { text-align: right; font-size: 11px; color: #555555; }
  .header .doc-title { font-size: 14pt; font-weight: 700; color: #6423d0; margin-bottom: 4px; }
  .parties { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 18px; }
  .party { flex: 1; min-width: 200px; border: 1px solid #e2e2e2; border-radius: 4px; padding: 10px 12px; }
  .party h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #888888; font-weight: 600; }
  .party .line { font-size: 11.5px; margin-bottom: 2px; }
  .table-wrap { overflow-x: auto; margin-bottom: 4px; }
  table { width: 100%; min-width: 480px; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #999999; padding: 6px 8px; font-size: 11px; vertical-align: top; }
  th { background: #f5f3fa; text-align: left; font-weight: 600; color: #444444; }
  .col-idx { width: 24px; text-align: center; }
  .col-article { width: 110px; color: #666666; }
  .col-num { width: 90px; text-align: right; white-space: nowrap; }
  .comment { margin-top: 18px; }
  .comment h4 { margin: 0 0 3px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.03em; color: #888888; font-weight: 600; }
  .comment p { margin: 0; font-size: 11px; white-space: pre-line; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #dddddd; text-align: center; }
  .footer-brand { margin: 0; font-size: 10.5px; font-weight: 600; color: #777777; }
  .footer-tagline { margin: 2px 0 0; font-size: 8.5px; color: #aaaaaa; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img src="${PLATFORM_LOGO_DATA_URI}" alt="" />
    </div>
    <div class="doc-meta">
      <div class="doc-title">Заявка на прорахунок № ${escapeHtml(data.number)}</div>
      <div>Дата: ${fmtDate(data.createdAt)}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Від кого</h3>
      <div class="line"><strong>${escapeHtml(data.companyName)}</strong></div>
    </div>
    <div class="party">
      <h3>Постачальник</h3>
      <div class="line"><strong>${escapeHtml(data.supplier.name)}</strong></div>
      ${data.supplier.contactPerson ? `<div class="line">${escapeHtml(data.supplier.contactPerson)}</div>` : ''}
      ${data.supplier.phone ? `<div class="line">${escapeHtml(data.supplier.phone)}</div>` : ''}
      ${data.supplier.email ? `<div class="line">${escapeHtml(data.supplier.email)}</div>` : ''}
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-idx">#</th>
          <th>Артикул</th>
          <th>Назва товару</th>
          <th class="col-num">Кількість</th>
          <th class="col-num">Орієнтовна ціна</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>

  ${data.comment ? `<div class="comment"><h4>Коментар</h4><p>${escapeHtml(data.comment)}</p></div>` : ''}

  <div class="footer">
    <p class="footer-brand">sh-erp.pro</p>
    <p class="footer-tagline">by Shyryng</p>
  </div>
</body>
</html>`;
  }
}

/** Every string interpolated above is user-entered (company/supplier names, item snapshots, comment) — escape unconditionally rather than trusting any of it, since this HTML gets loaded directly into a real Chromium page. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
