import { Injectable } from '@nestjs/common';
import { PLATFORM_LOGO_DATA_URI } from './platform-logo';

export interface QuotationRenderItem {
  kind: string;
  nameSnapshot: string;
  descriptionSnapshot: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  /** ASSEMBLY/PRODUCT lines only — resolved live from the current Assembly/Product at render time (not frozen at save-time like price), same "cosmetic, not financial" tier as the header logo. */
  article: string | null;
  photoUrl: string | null;
}

export interface QuotationRenderData {
  number: string;
  createdAt: Date;
  validUntil: Date | null;
  currency: string;
  customer: { name: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null };
  items: QuotationRenderItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  installationTerms: string | null;
  notes: string | null;
  companyDetailsText: string | null;
  accentColor: string | null;
  /** The company's own uploaded print logo (Settings → Branding → "Логотип друку", QuotationTemplate.printLogoFileId falling back to CompanyBranding.printLogoFileId — see QuotationsService#renderVersionHtml). Rendered NEXT TO the platform logo, never instead of it. */
  logoUrl: string | null;
  visibleBlocks: Record<string, boolean>;
}

/**
 * §8: "Quotation data → Quotation renderer → HTML → [Preview, PDF]" — the
 * ONE place that turns a quotation's data into markup. QuotationPdfService
 * feeds this HTML to Chromium for the real PDF; a future live-preview
 * endpoint (Task #41) calls this exact same method to render the editor's
 * preview pane, so the two can never visually drift apart the way this
 * app's own print-preview/@media-print CSS pair already has (see
 * print-area.tsx's own header comment on that recurring bug class) — here
 * there is only one code path, not two kept in sync by hand.
 *
 * Deliberately hardcodes a light palette (never reads the viewer's theme)
 * — this becomes a client-facing PDF, which must never depend on whoever
 * happens to be rendering it, same reasoning as globals.css's own
 * `@media print` block re-declaring every CSS variable.
 *
 * Pure and synchronous — no Prisma, no fetch, fully unit-testable; every
 * value it needs (including a pre-resolved logo URL) is passed in by the
 * caller, which alone knows how to reach FilesService/R2.
 */
@Injectable()
export class QuotationRendererService {
  renderHtml(data: QuotationRenderData): string {
    const visible = (key: string, fallback = true) => data.visibleBlocks[key] ?? fallback;
    const accent = data.accentColor && /^#[0-9a-fA-F]{3,8}$/.test(data.accentColor) ? data.accentColor : '#6423d0';
    const money = (v: number) => `${v.toFixed(2)} ${escapeHtml(data.currency)}`;
    const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString('uk-UA') : '—');

    const itemRows = data.items
      .map(
        (item, i) => `
        <tr>
          <td class="col-idx">${i + 1}</td>
          <td>
            <div class="item-row">
              ${item.photoUrl ? `<img class="item-photo" src="${escapeAttr(item.photoUrl)}" alt="" />` : ''}
              <div class="item-text">
                <div class="item-name">${item.article ? `<span class="item-article">${escapeHtml(item.article)}</span> — ` : ''}${escapeHtml(item.nameSnapshot)}</div>
                ${item.descriptionSnapshot ? `<div class="item-desc">${escapeHtml(item.descriptionSnapshot)}</div>` : ''}
              </div>
            </div>
          </td>
          <td class="col-num">${formatQty(item.quantity)} ${escapeHtml(item.unit)}</td>
          <td class="col-num">${money(item.unitPrice)}</td>
          <td class="col-num">${item.discountPercent > 0 ? `${formatQty(item.discountPercent)}%` : '—'}</td>
          <td class="col-num col-total">${money(item.total)}</td>
        </tr>`,
      )
      .join('');

    const termsBlocks = [
      visible('paymentTerms') && data.paymentTerms ? termBlock('Умови оплати', data.paymentTerms) : '',
      visible('deliveryTerms') && data.deliveryTerms ? termBlock('Умови доставки', data.deliveryTerms) : '',
      visible('installationTerms') && data.installationTerms ? termBlock('Умови монтажу', data.installationTerms) : '',
      visible('notes') && data.notes ? termBlock('Примітки', data.notes) : '',
    ].join('');

    return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<title>КП ${escapeHtml(data.number)}</title>
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
  .header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 2px solid ${accent}; padding-bottom: 10px; margin-bottom: 18px; }
  .header .brand { display: flex; align-items: center; gap: 14px; }
  .header .brand img { max-height: 42px; max-width: 150px; object-fit: contain; }
  .header .brand-divider { width: 1px; height: 34px; background: #dddddd; }
  .header .doc-meta { text-align: right; font-size: 11px; color: #555555; }
  .header .doc-title { font-size: 14pt; font-weight: 700; color: ${accent}; margin-bottom: 4px; }
  .company-details { font-size: 10.5px; color: #666666; margin-bottom: 16px; white-space: pre-line; }
  .parties { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 18px; }
  .party { flex: 1; min-width: 200px; border: 1px solid #e2e2e2; border-radius: 4px; padding: 10px 12px; }
  .party h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #888888; font-weight: 600; }
  .party .line { font-size: 11.5px; margin-bottom: 2px; }
  /*
   * On-screen only (the iframe preview and, if ever printed directly from a
   * browser, this same rule — @page's margin above is the only thing that
   * differs for the real PDF, which QuotationPdfService always renders at a
   * fixed A4-width Chromium viewport regardless of the viewer's device, so
   * this never affects the actual PDF file). The table's five columns
   * (#, qty, price, discount, total) already reserve 24 + 90*4 = 384px as
   * fixed widths, leaving only "Позиція" (photo + name) elastic — on a
   * narrow phone that column can be squeezed to zero, forcing the
   * fixed-size item photo to overflow into neighboring cells ("все на
   * купі", reported directly by a user on iPhone Pro Max). Wrapping the
   * table in its own horizontally-scrollable strip with a min-width lets
   * a narrow viewport scroll sideways to read it intact instead of the
   * columns colliding.
   */
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 4px; }
  table { width: 100%; min-width: 520px; border-collapse: collapse; table-layout: fixed; margin-bottom: 0; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #999999; padding: 6px 8px; font-size: 11px; vertical-align: top; }
  th { background: #f5f3fa; text-align: left; font-weight: 600; color: #444444; }
  .col-idx { width: 24px; text-align: center; }
  .col-num { width: 90px; text-align: right; white-space: nowrap; }
  .col-total { font-weight: 600; }
  .item-row { display: flex; gap: 8px; align-items: flex-start; }
  .item-photo { width: 36px; height: 36px; object-fit: cover; border-radius: 3px; border: 1px solid #dddddd; flex-shrink: 0; }
  .item-text { min-width: 0; }
  .item-article { color: #888888; font-weight: 400; }
  .item-name { font-weight: 600; }
  .item-desc { color: #666666; font-size: 10px; margin-top: 2px; }
  .totals { width: 260px; margin-left: auto; margin-top: 10px; font-size: 11.5px; }
  .totals .row { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .row.grand { border-top: 2px solid ${accent}; margin-top: 4px; padding-top: 8px; font-size: 13.5px; font-weight: 700; }
  .terms { margin-top: 22px; }
  .term-block { margin-bottom: 10px; }
  .term-block h4 { margin: 0 0 3px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.03em; color: #888888; font-weight: 600; }
  .term-block p { margin: 0; font-size: 11px; white-space: pre-line; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #dddddd; text-align: center; }
  .footer-brand { margin: 0; font-size: 10.5px; font-weight: 600; color: #777777; }
  .footer-tagline { margin: 2px 0 0; font-size: 8.5px; color: #aaaaaa; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img src="${PLATFORM_LOGO_DATA_URI}" alt="" />
      ${data.logoUrl ? `<span class="brand-divider"></span><img src="${escapeAttr(data.logoUrl)}" alt="" />` : ''}
    </div>
    <div class="doc-meta">
      <div class="doc-title">Комерційна пропозиція № ${escapeHtml(data.number)}</div>
      <div>Дата: ${fmtDate(data.createdAt)}</div>
      ${data.validUntil ? `<div>Дійсна до: ${fmtDate(data.validUntil)}</div>` : ''}
    </div>
  </div>

  ${visible('companyDetails') && data.companyDetailsText ? `<div class="company-details">${escapeHtml(data.companyDetailsText)}</div>` : ''}

  <div class="parties">
    <div class="party">
      <h3>Клієнт</h3>
      <div class="line"><strong>${escapeHtml(data.customer.name)}</strong></div>
      ${data.customer.contactPerson ? `<div class="line">${escapeHtml(data.customer.contactPerson)}</div>` : ''}
      ${data.customer.phone ? `<div class="line">${escapeHtml(data.customer.phone)}</div>` : ''}
      ${data.customer.email ? `<div class="line">${escapeHtml(data.customer.email)}</div>` : ''}
      ${data.customer.address ? `<div class="line">${escapeHtml(data.customer.address)}</div>` : ''}
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-idx">#</th>
          <th>Позиція</th>
          <th class="col-num">Кількість</th>
          <th class="col-num">Ціна</th>
          <th class="col-num">Знижка</th>
          <th class="col-num">Сума</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>

  <div class="totals">
    <div class="row"><span>Разом до знижки</span><span>${money(data.subtotal)}</span></div>
    ${data.discountAmount > 0 ? `<div class="row"><span>Знижка</span><span>-${money(data.discountAmount)}</span></div>` : ''}
    <div class="row grand"><span>До сплати</span><span>${money(data.total)}</span></div>
  </div>

  ${termsBlocks ? `<div class="terms">${termsBlocks}</div>` : ''}

  <div class="footer">
    <p class="footer-brand">sh-erp.com</p>
    <p class="footer-tagline">by Shyryng</p>
  </div>
</body>
</html>`;
  }
}

function termBlock(title: string, text: string): string {
  return `<div class="term-block"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(text)}</p></div>`;
}

function formatQty(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Every string interpolated above is user-entered (customer name, item names, notes, terms) — escape unconditionally rather than trusting any of it, since this HTML gets loaded directly into a real Chromium page. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
