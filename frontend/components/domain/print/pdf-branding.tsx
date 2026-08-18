import type { ReactNode } from 'react';

/**
 * Corporate PDF branding — the SH ERP wordmark top-left plus a
 * "SH-ERP.PRO / by Shyryng" footer, on every printed document. Rendered
 * exactly once here and composed straight into `<PrintArea>` (see
 * print-area.tsx) rather than required as a per-view opt-in — every one of
 * the app's print views (customer orders, BOM specs, supplier requests,
 * pick lists, product labels, planner, dashboard timeline, availability
 * reports, and anything printed in the future) already renders its content
 * inside `<PrintArea>`, so this reaches all of them automatically with zero
 * per-view wiring and nothing to forget on a new print view.
 *
 * Repeats on every physical printed page via `<thead>`/`<tfoot>` with
 * `display: table-header-group`/`table-footer-group` (globals.css) — NOT
 * `position: fixed`. A `position: fixed` element only ever repeats
 * correctly on the page it was reserved space for via container padding —
 * padding on a fragmented box applies once at the very top (page 1) and
 * once at the very bottom (the last page), never on the pages in between,
 * so a `fixed` header/footer overlapped real content on every page after
 * the first (confirmed live on a multi-page order). A table's
 * `table-header-group`/`table-footer-group` rows are specifically designed
 * by the CSS fragmentation model to repeat with correctly-reserved space on
 * every page a table spans — the exact mechanism this codebase already
 * relies on for the planner Gantt table's own repeating column header
 * (`.planner-print-table thead`, globals.css) — so this wraps all print
 * content in one such table instead of re-deriving the same problem a
 * second, less reliable way.
 */
export function PdfBranding({ children }: { children: ReactNode }) {
  return (
    <table className="pdf-page-frame" role="presentation">
      <thead>
        <tr>
          <td>
            <div className="pdf-header" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-sh-erp.svg" alt="" className="pdf-header-logo" />
            </div>
          </td>
        </tr>
      </thead>
      <tfoot>
        <tr>
          <td>
            <div className="pdf-footer" aria-hidden="true">
              <div className="pdf-footer-line" />
              <p className="pdf-footer-brand">SH-ERP.PRO</p>
              <p className="pdf-footer-tagline">by Shyryng</p>
            </div>
          </td>
        </tr>
      </tfoot>
      <tbody>
        <tr>
          <td>{children}</td>
        </tr>
      </tbody>
    </table>
  );
}
