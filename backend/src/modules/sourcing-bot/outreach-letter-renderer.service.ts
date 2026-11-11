import { Injectable } from '@nestjs/common';
import { PLATFORM_LOGO_DATA_URI } from '../quotations/platform-logo';

export interface OutreachLetterRenderItem {
  article: string;
  name: string;
  /** Presigned URL, same as every other list/detail view in this service — Chromium fetches it live during render (`renderHtmlToPdf` places no network restriction on the page), same as `PurchaseRequestRendererService`'s own `photoUrl`. Null when the product has no photo. */
  photoUrl: string | null;
}

export interface OutreachLetterRenderData {
  categoryName: string;
  createdAt: Date;
  fromName: string;
  supplierName: string;
  items: OutreachLetterRenderItem[];
}

/**
 * "формує пдф файл не так як заявка на прорахунок постачальникам"
 * (2026-11-11) — the company already has a real "Заявка на прорахунок"
 * document for exactly this purpose (`PurchaseRequestRendererService`,
 * sent to already-onboarded suppliers for a real order); this is its
 * visual twin for a CANDIDATE (not-yet-onboarded) supplier instead —
 * same header/parties/table/footer skeleton, copied rather than shared
 * (that renderer is a company-wide internal-procurement document; forking
 * it here keeps this exploratory, external-candidate use case from ever
 * affecting that one).
 *
 * Two deliberate differences from the PR template: no document number (no
 * real PurchaseRequest record backs this), and a blank "Ціна" column —
 * the exact opposite of the PR renderer's own "no price column" rule,
 * which makes sense there (don't show a known supplier your own guessed
 * price) but not here (there IS no price yet; the column is blank ON
 * PURPOSE, for the candidate to fill in when they quote back). No
 * "Кількість" column either — this is an exploratory "can you make these,
 * and at what price" letter, not a real order with known quantities.
 */
@Injectable()
export class OutreachLetterRendererService {
  renderHtml(data: OutreachLetterRenderData): string {
    const fmtDate = (d: Date) => new Date(d).toLocaleDateString('uk-UA');

    const itemRows = data.items
      .map(
        (item, i) => `
        <tr>
          <td class="col-idx">${i + 1}</td>
          <td class="col-photo">${item.photoUrl ? `<img class="item-photo" src="${escapeAttr(item.photoUrl)}" alt="" />` : ''}</td>
          <td class="col-article">${escapeHtml(item.article)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td class="col-num"></td>
        </tr>`,
      )
      .join('');

    return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<title>Заявка на прорахунок</title>
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
  .table-wrap { overflow-x: auto; margin-bottom: 4px; }
  table { width: 100%; min-width: 480px; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #999999; padding: 8px 10px; font-size: 13px; vertical-align: middle; }
  th { background: #f5f3fa; text-align: left; font-weight: 600; color: #444444; }
  .col-idx { width: 24px; text-align: center; }
  .col-photo { width: 62px; text-align: center; }
  .item-photo { width: 46px; height: 46px; object-fit: cover; border-radius: 4px; border: 1px solid #dddddd; }
  .col-article { width: 110px; color: #666666; }
  .col-num { width: 90px; text-align: right; white-space: nowrap; }
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
      <div class="doc-title">Заявка на прорахунок</div>
      <div>${escapeHtml(data.categoryName)}</div>
      <div>Дата: ${fmtDate(data.createdAt)}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Від кого</h3>
      <div class="line"><strong>${escapeHtml(data.fromName)}</strong></div>
    </div>
    <div class="party">
      <h3>Постачальник</h3>
      <div class="line"><strong>${escapeHtml(data.supplierName)}</strong></div>
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
          <th class="col-num">Ціна</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>

  <div class="footer">
    <p class="footer-brand">sh-erp.pro</p>
    <p class="footer-tagline">by Shyryng</p>
  </div>
</body>
</html>`;
  }
}

/** Every string interpolated above is user-entered (category/candidate/company names) — escape unconditionally, same as `PurchaseRequestRendererService`'s own rule, since this HTML loads directly into a real Chromium page. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
