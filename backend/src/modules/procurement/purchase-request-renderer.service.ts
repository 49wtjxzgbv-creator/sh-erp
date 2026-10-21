import { Injectable } from '@nestjs/common';
import { PLATFORM_LOGO_DATA_URI } from '../quotations/platform-logo';

export interface PurchaseRequestRenderItem {
  articleSnapshot: string;
  productNameSnapshot: string;
  qty: number;
  /** Live-resolved from the linked Product's own PRODUCT_PHOTO at render time (not frozen) — same "cosmetic, not financial" tier as Quotation's item photo. Null for a manually-typed line with no linked productId, or a product with no photo. */
  photoUrl: string | null;
}

export interface PurchaseRequestRenderData {
  number: string;
  createdAt: Date;
  /** "Від кого" block — resolved by the caller (PurchaseRequestsService#generatePdf): PurchaseRequest.fromName if set, else the company's own name. */
  fromName: string;
  /** Settings → Branding → "Логотип друку" (CompanyBranding.printLogoFileId), resolved to a presigned URL — shown next to fromName in the "Від кого" block, not in the top header (which always shows only the platform's own logo). */
  fromLogoUrl: string | null;
  /** Only the name — never the linked Supplier record's own contact/phone/email (2026-10-21 user request: the PDF should show just who we're addressing, not pull in extra fields the snapshot doesn't carry). */
  supplier: { name: string };
  comment: string | null;
  items: PurchaseRequestRenderItem[];
}

/**
 * The PurchaseRequest counterpart to QuotationRendererService — same "data
 * → HTML → Chromium" single-code-path shape (see that file's own header
 * comment), deliberately simpler: no templates/visibleBlocks/multi-locale,
 * since this is an internal staff document (one locale — Ukrainian — same
 * reasoning as the rest of this module's uk-only UI copy, not yet
 * translated like Quotations' customer-facing documents). No price column
 * (2026-10-21 user request — a buyer doesn't show their own guessed price
 * to the supplier they're asking to quote one); a live product photo per
 * line instead, same spirit as the removed price: help the supplier
 * recognize the part, don't anchor them to a number. Pure and synchronous
 * — no Prisma, no fetch; every resolved value (logo/photo URLs, fromName
 * fallback) is passed in by the caller.
 */
@Injectable()
export class PurchaseRequestRendererService {
  renderHtml(data: PurchaseRequestRenderData): string {
    const fmtQty = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
    const fmtDate = (d: Date) => new Date(d).toLocaleDateString('uk-UA');

    const itemRows = data.items
      .map(
        (item, i) => `
        <tr>
          <td class="col-idx">${i + 1}</td>
          <td class="col-photo">${item.photoUrl ? `<img class="item-photo" src="${escapeAttr(item.photoUrl)}" alt="" />` : ''}</td>
          <td class="col-article">${escapeHtml(item.articleSnapshot)}</td>
          <td>${escapeHtml(item.productNameSnapshot)}</td>
          <td class="col-num">${fmtQty(item.qty)}</td>
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
  .header .brand-divider { width: 1px; height: 28px; background: #dddddd; }
  .header .brand-site { font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em; color: #6423d0; }
  .header .doc-meta { text-align: right; font-size: 11px; color: #555555; }
  .header .doc-title { font-size: 14pt; font-weight: 700; color: #6423d0; margin-bottom: 4px; }
  .parties { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 18px; }
  .party { flex: 1; min-width: 200px; border: 1px solid #e2e2e2; border-radius: 4px; padding: 10px 12px; }
  .party h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #888888; font-weight: 600; }
  .party .line { font-size: 11.5px; margin-bottom: 2px; }
  .party-from-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .party-from-head img { max-height: 28px; max-width: 110px; object-fit: contain; }
  .table-wrap { overflow-x: auto; margin-bottom: 4px; }
  table { width: 100%; min-width: 480px; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #999999; padding: 6px 8px; font-size: 11px; vertical-align: top; }
  th { background: #f5f3fa; text-align: left; font-weight: 600; color: #444444; }
  .col-idx { width: 24px; text-align: center; }
  .col-photo { width: 90px; text-align: center; }
  .item-photo { width: 68px; height: 68px; object-fit: cover; border-radius: 4px; border: 1px solid #dddddd; }
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
      <span class="brand-divider"></span>
      <span class="brand-site">SH-ERP.PRO</span>
    </div>
    <div class="doc-meta">
      <div class="doc-title">Заявка на прорахунок № ${escapeHtml(data.number)}</div>
      <div>Дата: ${fmtDate(data.createdAt)}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Від кого</h3>
      <div class="party-from-head">
        ${data.fromLogoUrl ? `<img src="${escapeAttr(data.fromLogoUrl)}" alt="" />` : ''}
        <div class="line"><strong>${escapeHtml(data.fromName)}</strong></div>
      </div>
    </div>
    <div class="party">
      <h3>Постачальник</h3>
      <div class="line"><strong>${escapeHtml(data.supplier.name)}</strong></div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-idx">#</th>
          <th class="col-photo"></th>
          <th>Артикул</th>
          <th>Назва товару</th>
          <th class="col-num">Кількість</th>
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

/** Every string interpolated above is user-entered (from/supplier names, item snapshots, comment) — escape unconditionally rather than trusting any of it, since this HTML gets loaded directly into a real Chromium page. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
