import { Injectable } from '@nestjs/common';
import { PLATFORM_LOGO_DATA_URI } from '../quotations/platform-logo';

export interface PurchaseOrderRenderItem {
  articleSnapshot: string;
  productNameSnapshot: string;
  qty: number;
  /** Prefers the supplier's own portal-confirmed price over our own expectedPrice — the most authoritative "what we agreed" figure at order time. Null when neither was ever set (shows as "—", excluded from the total). */
  unitPrice: number | null;
  /** Live-resolved from the linked Product's/Assembly's own PHOTO at render time — same "cosmetic, not financial" tier as PurchaseRequest's item photo. */
  photoUrl: string | null;
  /** "а дати поставки" (2026-11-04) — this line's own Delivery Schedule split (currentDeliveryScheduleId's lines), if staff have filled one in. Empty when none exists yet — the item then falls back to data.expectedDeliveryDate in the table (same single date every line shows until it gets its own schedule). */
  deliveryDates: { date: Date; qty: number }[];
}

export interface PurchaseOrderRenderData {
  number: string;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  fromName: string;
  fromLogoUrl: string | null;
  supplier: { name: string };
  comment: string | null;
  currency: string;
  items: PurchaseOrderRenderItem[];
}

function formatMoney(value: number, currency: string): string {
  const amount = value.toFixed(2);
  return currency === 'EUR' ? `${amount} €` : `${amount} ${currency}`;
}

/**
 * The PurchaseOrder counterpart to PurchaseRequestRendererService — same
 * "data → HTML → Chromium" single-code-path shape (see that file's own
 * header comment), same deliberately simple internal-document styling.
 * Two real differences from the заявка template: this IS a committed
 * order, so it shows price/subtotal/total (PurchaseRequestRendererService
 * deliberately hides price — "a buyer doesn't show their own guessed
 * price to the supplier they're asking to quote one" — that reasoning
 * doesn't apply once the order is actually placed), and the header meta
 * shows the expected delivery date alongside the order date. No file
 * attachments (unlike PurchaseRequestItem, PurchaseOrderItem has no
 * attachedFileIds), so PurchaseOrderPdfService has no merge step either.
 */
@Injectable()
export class PurchaseOrderRendererService {
  renderHtml(data: PurchaseOrderRenderData): string {
    const fmtQty = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
    const fmtDate = (d: Date) => new Date(d).toLocaleDateString('uk-UA');

    let total = 0;
    const itemRows = data.items
      .map((item, i) => {
        const subtotal = item.unitPrice != null ? item.unitPrice * item.qty : null;
        if (subtotal != null) total += subtotal;

        // Per-line schedule split if one exists ("10.11: 175, 18.11: 175");
        // otherwise fall back to the single order-level expected date every
        // undated line shares until staff splits it into its own schedule.
        const deliveryCell =
          item.deliveryDates.length > 0
            ? item.deliveryDates.map((d) => `${fmtDate(d.date)}: ${fmtQty(d.qty)}`).join('<br/>')
            : data.expectedDeliveryDate
              ? fmtDate(data.expectedDeliveryDate)
              : '—';

        return `
        <tr>
          <td class="col-idx">${i + 1}</td>
          <td class="col-photo">${item.photoUrl ? `<img class="item-photo" src="${escapeAttr(item.photoUrl)}" alt="" />` : ''}</td>
          <td class="col-article">${escapeHtml(item.articleSnapshot)}</td>
          <td>${escapeHtml(item.productNameSnapshot)}</td>
          <td class="col-num">${fmtQty(item.qty)}</td>
          <td class="col-date">${deliveryCell}</td>
          <td class="col-num">${item.unitPrice != null ? formatMoney(item.unitPrice, data.currency) : '—'}</td>
          <td class="col-num">${subtotal != null ? formatMoney(subtotal, data.currency) : '—'}</td>
        </tr>`;
      })
      .join('');

    return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<title>Замовлення постачальнику ${escapeHtml(data.number)}</title>
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
  table { width: 100%; min-width: 680px; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #999999; padding: 8px 10px; font-size: 13px; vertical-align: middle; }
  th { background: #f5f3fa; text-align: left; font-weight: 600; color: #444444; }
  .col-idx { width: 24px; text-align: center; }
  .col-photo { width: 62px; text-align: center; }
  .item-photo { width: 46px; height: 46px; object-fit: cover; border-radius: 4px; border: 1px solid #dddddd; }
  .col-article { width: 100px; color: #666666; }
  .col-num { width: 84px; text-align: right; white-space: nowrap; }
  .col-date { width: 110px; font-size: 11.5px; color: #444444; }
  tfoot td { border: none; padding: 8px 10px; }
  .total-row td { border-top: 2px solid #6423d0; font-weight: 700; font-size: 13.5px; }
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
      <div class="doc-title">Замовлення постачальнику № ${escapeHtml(data.number)}</div>
      <div>Дата замовлення: ${fmtDate(data.orderDate)}</div>
      ${data.expectedDeliveryDate ? `<div>Очікувана дата постачання: ${fmtDate(data.expectedDeliveryDate)}</div>` : ''}
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
          <th class="col-date">Дата поставки</th>
          <th class="col-num">Ціна</th>
          <th class="col-num">Сума</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr class="total-row">
          <td colspan="6"></td>
          <td>Разом:</td>
          <td class="col-num">${formatMoney(total, data.currency)}</td>
        </tr>
      </tfoot>
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

/** Every string interpolated above is user-entered (supplier/company names, item snapshots, comment) — escape unconditionally rather than trusting any of it, since this HTML gets loaded directly into a real Chromium page. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
